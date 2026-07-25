#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FleetTrackerStack } from '../lib/fleet-tracker-stack';

const app = new cdk.App();

// Context values are supplied by scripts/deploy.sh, which detects whether a
// Route 53 zone for the parent domain exists in this account. Nothing here
// performs an environment lookup, so `cdk synth` works without credentials.
const domainName = app.node.tryGetContext('domainName') || 'tracker.ravensoft.click';
const zoneName = app.node.tryGetContext('zoneName') || domainName.split('.').slice(1).join('.');
const hostedZoneId = app.node.tryGetContext('hostedZoneId') || undefined;
const certificateArn = app.node.tryGetContext('certificateArn') || undefined;
const ssmPrefix = app.node.tryGetContext('ssmPrefix') || '/fleet-tracker';

new FleetTrackerStack(app, 'FleetTrackerStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    // us-east-1 is required: CloudFront can only use ACM certificates from there.
    region: 'us-east-1',
  },
  domainName,
  zoneName,
  hostedZoneId,
  certificateArn,
  ssmPrefix,
  description: 'fleet-income-tracker — SPA on S3/CloudFront, API Lambda, DynamoDB',
});
