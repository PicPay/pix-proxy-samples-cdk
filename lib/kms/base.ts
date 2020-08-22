import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as route53 from '@aws-cdk/aws-route53';
import {Config} from "./config";

export interface BaseProps {
    readonly config: Config;
}

export class Base extends cdk.Construct {

    readonly vpc: ec2.Vpc;
    static readonly vpcCidrExportName:string = 'Pix-Proxy-KMS-VpcCidr';
    static readonly vpcIdExportName:string = 'Pix-Proxy-KMS-VpcId';
    static readonly vpcAZsExportName:string = 'Pix-Proxy-KMS-VpcAZs';
    static readonly vpcPrivateSubnetIdsAZsExportName:string = 'Pix-Proxy-KMS-VpcPrivateSubnetIds';
    static readonly vpcPublicSubnetIdsAZsExportName:string = 'Pix-Proxy-KMS-VpcPublicSubnetIds';

    readonly zone: route53.PrivateHostedZone;
    static readonly zoneName:string = 'rsfn.net.br';
    static readonly zoneNameExportName:string = 'Pix-Proxy-KMS-RsfnZone';

    constructor(scope: cdk.Construct, id: string, props: BaseProps) {
        super(scope, id);

        this.vpc = this.createVpc();
        this.zone = this.createZone();
    }

    private createVpc(): ec2.Vpc {
        let vpc = new ec2.Vpc(this, 'Vpc', {
            maxAzs: 2,
            cidr: '172.28.0.0/16'
        });
        this.outputAndExport('ProxyVpcId', vpc.vpcId, Base.vpcIdExportName);
        this.outputAndExport('ProxyVpcCidr', vpc.vpcCidrBlock, Base.vpcCidrExportName);
        this.outputAndExport('ProxyVpcAZs', cdk.Fn.join(',', vpc.availabilityZones), Base.vpcAZsExportName);
        this.outputAndExport('ProxyVpcPrivateSubnetIds', cdk.Fn.join(',', vpc.privateSubnets.map(s => s.subnetId)), Base.vpcPrivateSubnetIdsAZsExportName);
        this.outputAndExport('ProxyVpcPublicSubnetIds', cdk.Fn.join(',', vpc.privateSubnets.map(s => s.subnetId)), Base.vpcPublicSubnetIdsAZsExportName);

        return vpc;
    }

    private createZone(): route53.PrivateHostedZone {
        let zone = new route53.PrivateHostedZone(this, 'Zone', {
            vpc: this.vpc,
            zoneName: Base.zoneName
        });
        this.outputAndExport('Route53RSFNZone', zone.hostedZoneId, Base.zoneNameExportName);

        return zone;
    }

    private outputAndExport(id: string, value: string, exportName: string) {
        let output = new cdk.CfnOutput(this, id, {
            value: value,
            exportName: exportName
        });
        output.overrideLogicalId(id);
    }

}