import * as cdk from "@aws-cdk/core";
import {Config} from "./config";
import {Pipeline} from "./pipeline";
import {Base} from "./base";
import * as testBase from "../test/base";
import * as testCluster from "../test/cluster";
import {Cluster} from "./cluster";
import {Audit} from "../audit/audit";

const repoTestExportName = 'Pix-Proxy-CloudHSM-EcrRepoTest';

export class Stack extends cdk.Stack {

    readonly config: Config;
    readonly base: Base;
    readonly testBase: testBase.Base;
    readonly audit: Audit;
    readonly pipeline: Pipeline;

    constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        this.config = new Config(this, 'Config');

        this.base = new Base(this, 'Base', {
            config: this.config
        })

        this.testBase = new testBase.Base(this, 'TestBase', {
            repoExportName: repoTestExportName
        })

        this.audit = new Audit(this, 'Audit', {
            region: this.region,
            glueDatabaseName: 'pix-proxy-cloudhsm',
            dictAuditStreamParam: Config.dictAuditStream,
            spiAuditStreamParam: Config.spiAuditStream
        });

        this.pipeline = new Pipeline(this, 'Pipeline', {
            config: this.config,
            base: this.base,
            testBase: this.testBase
        });
    }
}

export class ClusterStack extends cdk.Stack {

    readonly cluster: Cluster;
    readonly testCluster: testCluster.Cluster;

    constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        this.cluster = new Cluster(this, 'Cluster', {
            region: this.region,
            account: this.account
        });

        this.testCluster = new testCluster.Cluster(this, 'ClusterTest', {
            region: this.region,
            account: this.account,
            vpc: this.cluster.vpc,
            repoImportName: repoTestExportName,
            zoneName: Base.zoneName,
            zoneImportName: Base.zoneNameExportName
        });
    }
}