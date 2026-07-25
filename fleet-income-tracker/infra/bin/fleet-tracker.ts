#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FleetTrackerStack } from '../lib/fleet-tracker-stack';

const app = new cdk.App();

/**
 * The AWS account this app belongs to — the same one that already serves
 * ravensoft.click and holds its Route 53 hosted zone.
 *
 * Pinned deliberately. Without it CDK takes whatever account the ambient
 * credentials point at, so a stale profile would silently deploy a second copy
 * of everything somewhere else and the hosted-zone lookup would quietly fail
 * over to the manual-DNS path. Override with `-c account=…` only when you mean
 * to target a different account.
 */
const EXPECTED_ACCOUNT = '191331702653';
const account = app.node.tryGetContext('account') || EXPECTED_ACCOUNT;

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
    account,
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
