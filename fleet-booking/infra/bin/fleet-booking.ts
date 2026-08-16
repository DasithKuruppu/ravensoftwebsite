#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FleetBookingStack } from '../lib/fleet-booking-stack';

const app = new cdk.App();

/**
 * The AWS account this app belongs to — the same one that serves
 * ravensoft.click and holds its Route 53 hosted zone, and the same one
 * FleetTrackerStack is pinned to.
 *
 * Pinned deliberately: without it CDK takes whatever account the ambient
 * credentials point at, so a stale profile would silently deploy a second copy
 * of everything somewhere else. Override with `-c account=…` only on purpose.
 */
const EXPECTED_ACCOUNT = '191331702653';
const account = app.node.tryGetContext('account') || EXPECTED_ACCOUNT;

// Context values come from scripts/deploy.sh, which detects whether a Route 53
// zone for the parent domain exists here. Nothing in this file performs an
// environment lookup, so `cdk synth` works without credentials.
const domainName = app.node.tryGetContext('domainName') || 'fleet.ravensoft.click';
const zoneName = app.node.tryGetContext('zoneName') || domainName.split('.').slice(1).join('.');
const hostedZoneId = app.node.tryGetContext('hostedZoneId') || undefined;
const certificateArn = app.node.tryGetContext('certificateArn') || undefined;
const ssmPrefix = app.node.tryGetContext('ssmPrefix') || '/fleet-booking';
const ownerEmails = app.node.tryGetContext('ownerEmails') || process.env.OWNER_EMAILS || '';

new FleetBookingStack(app, 'FleetBookingStack', {
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
  ownerEmails,
  description: 'fleet-booking — public booking SPA on S3/CloudFront, API Lambda, DynamoDB',
});
