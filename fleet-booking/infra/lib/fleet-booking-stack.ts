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
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

export interface FleetBookingStackProps extends cdk.StackProps {
  /** e.g. fleet.ravensoft.click */
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
  /** Comma-separated emails allowed the admin routes. */
  ownerEmails: string;
}

/**
 * fleet.ravensoft.click — the public booking site.
 *
 * A separate stack with a separate table from FleetTrackerStack on purpose. The
 * tracker is a private tool holding the owner's margins; this is a page anyone
 * on the internet can reach. Sharing a table between them would mean one IAM
 * policy covering both, and a bug in the public API reaching the private data.
 */
export class FleetBookingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FleetBookingStackProps) {
    super(scope, id, props);

    const { domainName, hostedZoneId, zoneName, certificateArn, ssmPrefix, ownerEmails } = props;
    const appRoot = path.join(__dirname, '../..');

    /* ───────────── 1. DynamoDB — bookings, rate card, routing cache ───────────── */

    const table = new dynamodb.Table(this, 'Table', {
      tableName: 'fleet-booking',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // Geocode and route answers carry an expiry; DynamoDB sweeps them for free.
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // "What have I booked" — one customer, in start-date order.
    table.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // "What is coming up" — every booking, same order. A second index rather
    // than an overloaded one: both queries want the whole partition sorted by
    // start, and folding them together would mean filtering one of the two.
    table.addGlobalSecondaryIndex({
      indexName: 'gsi2',
      partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    /* ───────────── 2. Certificate + hosted zone (both DNS paths) ───────────── */

    const zone =
      hostedZoneId && zoneName
        ? route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', { hostedZoneId, zoneName })
        : undefined;

    let certificate: acm.ICertificate | undefined;
    if (zone) {
      certificate = new acm.Certificate(this, 'Certificate', {
        domainName,
        validation: acm.CertificateValidation.fromDns(zone),
      });
    } else if (certificateArn) {
      certificate = acm.Certificate.fromCertificateArn(this, 'Certificate', certificateArn);
    }

    /* ───────────── 3. Private S3 bucket + CloudFront (OAC) ───────────── */

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: `fleet-booking-site-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'fleet-booking SPA',
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.minutes(5) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.minutes(5) },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      ...(certificate ? { certificate, domainNames: [domainName] } : {}),
    });

    if (zone) {
      new route53.ARecord(this, 'AliasRecord', {
        zone,
        recordName: domainName.replace(`.${zone.zoneName}`, ''),
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
      });
    }

    /* ───────────── 4. API Lambda + HTTP API ───────────── */

    const appOrigin = certificate ? `https://${domainName}` : `https://${distribution.distributionDomainName}`;
    const allowedOrigins = [appOrigin, 'http://localhost:5174'];

    const apiFn = new NodejsFunction(this, 'ApiFunction', {
      functionName: 'fleet-booking-api',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(appRoot, 'api/handler.mjs'),
      handler: 'handler',
      memorySize: 512,
      // Two outbound calls — Clerk's JWKS and OSRM — can each take a few seconds
      // on a cold path, and a quote that times out looks like a broken site.
      timeout: cdk.Duration.seconds(20),
      environment: {
        TABLE_NAME: table.tableName,
        STORE: 'ddb',
        SSM_PREFIX: ssmPrefix,
        ALLOWED_ORIGINS: allowedOrigins.join(','),
        OWNER_EMAILS: ownerEmails,
        TZ_NAME: 'Asia/Colombo',
      },
      projectRoot: appRoot,
      depsLockFilePath: path.join(appRoot, 'package-lock.json'),
      bundling: {
        format: OutputFormat.CJS,
        minify: true,
        sourceMap: false,
        // The Node runtime ships the AWS SDK v3 — don't bundle it. `jose` is not
        // in the runtime, so it does get bundled.
        externalModules: ['@aws-sdk/*'],
      },
    });

    table.grantReadWriteData(apiFn);

    const ssmArn = (name: string) =>
      cdk.Arn.format(
        { service: 'ssm', resource: 'parameter', resourceName: `${ssmPrefix.replace(/^\//, '')}/${name}` },
        this,
      );

    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          ssmArn('clerk-issuer'),
          ssmArn('clerk-secret-key'),
          // The server-side Maps key: Places autocomplete, place details and
          // Routes. Never reaches the browser — the map uses a separate,
          // referrer-restricted key baked into the bundle.
          ssmArn('google-maps-api-key'),
        ],
      }),
    );

    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'fleet-booking-api',
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

    // One Lambda, every route. Sessions and the owner check live in the handler.
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

    /* ───────────── 5. Outputs (consumed by the deploy scripts) ───────────── */

    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint, description: 'API Gateway HTTP API base URL' });
    new cdk.CfnOutput(this, 'SiteBucketName', { value: siteBucket.bucketName });
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
      description: 'CNAME target for the fleet subdomain when DNS is managed outside this account',
    });
    new cdk.CfnOutput(this, 'AppUrl', { value: appOrigin });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
