import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as ecr from "@aws-cdk/aws-ecr";
import * as route53 from '@aws-cdk/aws-route53';
import {Config} from "./config";

export interface BaseProps {
    readonly config: Config;
}

export class Base extends cdk.Construct {

    private readonly props: BaseProps;

    readonly vpc: ec2.Vpc;
    static readonly vpcIdExportName:string = 'Pix-Proxy-CloudHSM-VpcId';
    static readonly vpcAZsExportName:string = 'Pix-Proxy-CloudHSM-VpcAZs';
    static readonly vpcPrivateSubnetIdsAZsExportName:string = 'Pix-Proxy-CloudHSM-VpcPrivateSubnetIds';
    static readonly vpcPublicSubnetIdsAZsExportName:string = 'Pix-Proxy-CloudHSM-VpcPublicSubnetIds';

    readonly zone: route53.PrivateHostedZone;
    static readonly zoneName:string = 'rsfn.net.br';
    static readonly zoneNameExportName:string = 'Pix-Proxy-CloudHSM-RsfnZone';

    readonly repo: ecr.Repository;
    static readonly repoNameExportName:string = 'Pix-Proxy-CloudHSM-EcrRepo';

    constructor(scope: cdk.Construct, id: string, props: BaseProps) {
        super(scope, id);

        this.props = props;
        this.vpc = this.createVpc();
        this.zone = this.createZone();
        this.repo = this.createEcrRepo('Proxy', Base.repoNameExportName);
    }

    private createVpc(): ec2.Vpc {
        let vpc = new ec2.Vpc(this, 'Vpc', {
            maxAzs: 2,
            cidr: '172.29.0.0/16'
        });
        this.outputAndExport('ProxyVpcId', vpc.vpcId, Base.vpcIdExportName);

        let vpcPeering = new ec2.CfnVPCPeeringConnection(this, 'VpcPeering', {
            vpcId: vpc.vpcId,
            peerVpcId: this.props.config.hsmVpc.valueAsString
        });
        this.output('ProxyVpcPeering', vpcPeering.ref);

        vpc.privateSubnets.forEach((subnet, index) => {
            (subnet as ec2.Subnet).addRoute(`PeeringRoute-${index}`, {
                destinationCidrBlock: this.props.config.hsmVpcCidr.valueAsString,
                routerId: vpcPeering.ref,
                routerType: ec2.RouterType.VPC_PEERING_CONNECTION
            })
        });

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

    private createEcrRepo(type: string, exportName: string): ecr.Repository {
        let repo = new ecr.Repository(this, `Repo${type}`);
        this.outputAndExport(`EcrRepo${type}`, repo.repositoryName, exportName);
        return repo;
    }

    private output(id: string, value: string) {
        let output = new cdk.CfnOutput(this, id, {
            value: value
        });
        output.overrideLogicalId(id);
    }

    private outputAndExport(id: string, value: string, exportName: string) {
        let output = new cdk.CfnOutput(this, id, {
            value: value,
            exportName: exportName
        });
        output.overrideLogicalId(id);
    }

}