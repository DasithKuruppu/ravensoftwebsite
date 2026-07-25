import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

export interface FleetTrackerStackProps extends cdk.StackProps {
  /** e.g. tracker.ravensoft.click */
  domainName: string;
  /**
   * Route 53 zone for the parent domain, if one exists in this account. When
   * present the stack owns cert validation and the alias record. When absent
   * the deploy script requests the certificate out of band, prints the CNAMEs
   * to add manually, and passes the ARN back in via `certificateArn`.
   */
  hostedZoneId?: string;
  zoneName?: string;
  certificateArn?: string;
  /** SSM path prefix holding the SecureString secrets. */
  ssmPrefix: string;
}

export class FleetTrackerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FleetTrackerStackProps) {
    super(scope, id, props);

    const { domainName, hostedZoneId, zoneName, certificateArn, ssmPrefix } = props;
    const appRoot = path.join(__dirname, '../..');

    /* ───────────── 1. DynamoDB — one table, single-table design ───────────── */

    const table = new dynamodb.Table(this, 'Table', {
      tableName: 'fleet-tracker',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      // On-demand: no hourly charge, and this volume stays inside the free tier.
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    /* ───────────── 2. Certificate + hosted zone (both DNS paths) ───────────── */

    const zone =
      hostedZoneId && zoneName
        ? route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
            hostedZoneId,
            zoneName,
          })
        : undefined;

    let certificate: acm.ICertificate | undefined;
    if (zone) {
      // Zone in this account: CDK creates the cert and its validation records.
      certificate = new acm.Certificate(this, 'Certificate', {
        domainName,
        validation: acm.CertificateValidation.fromDns(zone),
      });
    } else if (certificateArn) {
      // DNS lives elsewhere: the deploy script requested and validated the cert.
      certificate = acm.Certificate.fromCertificateArn(this, 'Certificate', certificateArn);
    }

    /* ───────────── 3. Private S3 bucket + CloudFront (OAC) ───────────── */

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: `fleet-tracker-site-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'fleet-income-tracker SPA',
      defaultRootObject: 'index.html',
      // Origin Access Control — the bucket itself is never publicly readable.
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      // SPA routing: deep links resolve to index.html and React Router takes over.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.minutes(5) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.minutes(5) },
      ],
      // PriceClass 100 = North America + Europe: cheapest tier, still free-tier eligible.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      ...(certificate ? { certificate, domainNames: [domainName] } : {}),
    });

    // Alias record, only when the zone is in this account.
    if (zone) {
      new route53.ARecord(this, 'AliasRecord', {
        zone,
        recordName: domainName.replace(`.${zone.zoneName}`, ''),
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
      });
    }

    /* ───────────── 4. API Lambda + HTTP API ───────────── */

    const appOrigin = certificate ? `https://${domainName}` : `https://${distribution.distributionDomainName}`;
    const allowedOrigins = [appOrigin, 'http://localhost:5173'];

    const bundling = {
      format: OutputFormat.CJS,
      minify: true,
      sourceMap: false,
      // The Node 20 runtime ships the AWS SDK v3 — don't bundle it.
      externalModules: ['@aws-sdk/*'],
    };

    // The Lambda sources live in the app root, one level above infra/.
    const nodeDefaults = {
      projectRoot: appRoot,
      depsLockFilePath: path.join(appRoot, 'package-lock.json'),
      bundling,
    };

    const apiFn = new NodejsFunction(this, 'ApiFunction', {
      functionName: 'fleet-tracker-api',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(appRoot, 'api/handler.mjs'),
      handler: 'handler',
      memorySize: 512,
      timeout: cdk.Duration.seconds(15),
      environment: {
        TABLE_NAME: table.tableName,
        STORE: 'ddb',
        SSM_PREFIX: ssmPrefix,
        ALLOWED_ORIGINS: allowedOrigins.join(','),
        TZ_NAME: 'Asia/Colombo',
      },
      ...nodeDefaults,
    });

    const syncFn = new NodejsFunction(this, 'SyncFunction', {
      functionName: 'fleet-tracker-sync',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(appRoot, 'jobs/sync.mjs'),
      handler: 'handler',
      memorySize: 512,
      timeout: cdk.Duration.minutes(2),
      environment: {
        TABLE_NAME: table.tableName,
        STORE: 'ddb',
        SSM_PREFIX: ssmPrefix,
        TZ_NAME: 'Asia/Colombo',
      },
      ...nodeDefaults,
    });

    /* ───────────── 5. IAM — least privilege ───────────── */

    table.grantReadWriteData(apiFn);
    table.grantReadWriteData(syncFn);

    // Each function reads only the SecureStrings it actually needs.
    const ssmArn = (name: string) =>
      cdk.Arn.format(
        { service: 'ssm', resource: 'parameter', resourceName: `${ssmPrefix.replace(/^\//, '')}/${name}` },
        this,
      );

    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          ssmArn('jwt-secret'),
          ssmArn('owner-password-hash'),
          ssmArn('driver-password-hash'),
        ],
      }),
    );

    syncFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          ssmArn('dagps-user'),
          ssmArn('dagps-pass'),
          ssmArn('uber-client-id'),
          ssmArn('uber-client-secret'),
        ],
      }),
    );

    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'fleet-tracker-api',
      corsPreflight: {
        allowOrigins: allowedOrigins,
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['content-type', 'authorization'],
        maxAge: cdk.Duration.days(1),
      },
    });

    // One Lambda, every route. Auth and roles are enforced inside the handler.
    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [
        apigwv2.HttpMethod.GET,
        apigwv2.HttpMethod.POST,
        apigwv2.HttpMethod.PUT,
        apigwv2.HttpMethod.DELETE,
      ],
      integration: new integrations.HttpLambdaIntegration('ApiIntegration', apiFn),
    });

    /* ───────────── 6. Scheduled sync jobs ───────────── */

    // 23:30 Asia/Colombo = 18:00 UTC (UTC+5:30, no DST).
    new events.Rule(this, 'DagpsSchedule', {
      ruleName: 'fleet-tracker-dagps-nightly',
      description: 'DAGPS mileage pull — 23:30 Asia/Colombo',
      schedule: events.Schedule.cron({ minute: '0', hour: '18' }),
      targets: [new eventTargets.LambdaFunction(syncFn, { event: events.RuleTargetInput.fromObject({ job: 'dagps' }) })],
    });

    // Placeholder until Uber grants Supplier API access; 02:00 Asia/Colombo.
    new events.Rule(this, 'UberSchedule', {
      ruleName: 'fleet-tracker-uber-daily',
      description: 'Uber earnings pull — placeholder, 02:00 Asia/Colombo',
      schedule: events.Schedule.cron({ minute: '30', hour: '20' }),
      targets: [new eventTargets.LambdaFunction(syncFn, { event: events.RuleTargetInput.fromObject({ job: 'uber' }) })],
    });

    /* ───────────── 7. Outputs (consumed by the deploy scripts) ───────────── */

    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint, description: 'API Gateway HTTP API base URL' });
    new cdk.CfnOutput(this, 'SiteBucketName', { value: siteBucket.bucketName });
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
      description: 'CNAME target for the tracker subdomain when DNS is managed outside this account',
    });
    new cdk.CfnOutput(this, 'AppUrl', { value: appOrigin });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
