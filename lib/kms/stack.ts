import * as cdk from "@aws-cdk/core";
import * as lambda from '@aws-cdk/aws-lambda';
import { Config } from "./config";
import { Base } from "./base";
import * as testBase from "../test/base";
import * as testCluster from "../test/cluster";
import {Audit} from "../audit/audit";
import {Pipeline} from "./pipeline";
import { Proxy } from "./proxy";

const repoTestExportName = 'Pix-Proxy-KMS-EcrRepoTest';

export interface StackProps extends cdk.StackProps {
    readonly lambdaCode: lambda.CfnParametersCode;
}

export class Stack extends cdk.Stack {

    readonly config: Config;
    readonly base: Base;
    readonly testBase: testBase.Base;
    readonly audit: Audit;
    readonly pipeline: Pipeline;

    constructor(scope: cdk.Construct, id: string, props: StackProps) {
        super(scope, id, props);

        this.config = new Config(this, 'Config');

        this.base = new Base(this, 'Base', {
            config: this.config
        });

        this.testBase = new testBase.Base(this, 'TestBase', {
            repoExportName: repoTestExportName
        });

        this.audit = new Audit(this, 'Audit', {
            region: this.region,
            glueDatabaseName: 'pix-proxy-kms',
            dictAuditStreamParam: Config.dictAuditStream,
            spiAuditStreamParam: Config.spiAuditStream
        });

        this.pipeline = new Pipeline(this, 'Pipeline', {
            config: this.config,
            base: this.base,
            lambdaCode: props.lambdaCode,
            testBase: this.testBase
        });

    }
    
}

export class LambdaStack extends cdk.Stack {

    readonly proxy: Proxy;
    readonly testCluster: testCluster.Cluster;

    constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        this.proxy = new Proxy(this, 'Proxy', {
            region: this.region,
            account: this.account
        });

        this.testCluster = new testCluster.Cluster(this, 'ClusterTest', {
            region: this.region,
            account: this.account,
            vpc: this.proxy.vpc,
            repoImportName: repoTestExportName,
            zoneName: Base.zoneName,
            zoneImportName: Base.zoneNameExportName
        });
    }
}
        