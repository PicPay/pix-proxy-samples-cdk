import * as cdk from '@aws-cdk/core';
import * as ssm from "@aws-cdk/aws-ssm";
import * as secretsmanager from "@aws-cdk/aws-secretsmanager";

export class Config extends cdk.Construct {

    static readonly parameterPrefix: string = '/pix/proxy/cloudhsm/';

    static readonly dictAuditStream:string = Config.getParameterName('DictAuditStream');
    static readonly spiAuditStream:string = Config.getParameterName('SpiAuditStream');

    readonly hsmClusterId: ssm.StringParameter;
    static readonly hsmClusterId: string = 'CloudHSMClusterId';

    readonly hsmCustomerCA: ssm.StringParameter;
    static readonly hsmCustomerCA: string = 'CloudHSMCustomerCA';

    readonly hsmSecret: secretsmanager.Secret;
    static readonly hsmSecret: string = 'CloudHSMSecret';

    readonly hsmVpc: cdk.CfnParameter;
    readonly hsmVpcCidr: cdk.CfnParameter;

    readonly mtlsKeyLabel: ssm.StringParameter;
    static readonly mtlsKeyLabel: string = 'MtlsKeyLabel';

    readonly mtlsCertificate: ssm.StringParameter;
    static readonly mtlsCertificate: string = 'MtlsCertificate';

    readonly signatureKeyLabel: ssm.StringParameter;
    static readonly signatureKeyLabel: string = 'SignatureKeyLabel';

    readonly signatureCertificate: ssm.StringParameter;
    static readonly signatureCertificate: string = 'SignatureCertificate';

    readonly bcbMtlsCertificate: ssm.StringParameter;
    static readonly bcbMtlsCertificate: string = 'BcbMtlsCertificate';

    readonly bcbSignatureCertificate: ssm.StringParameter;
    static readonly bcbSignatureCertificate: string = 'BcbSignatureCertificate';

    readonly bcbDictEndpoint: ssm.StringParameter;
    static readonly bcbDictEndpoint: string = 'BcbDictEndpoint';

    readonly bcbSpiEndpoint: ssm.StringParameter;
    static readonly bcbSpiEndpoint: string = 'BcbSpiEndpoint';

    readonly gitHubSecret: secretsmanager.Secret;
    static readonly gitHubSecret: string = 'GitHubToken';
    readonly gitHubSecretTokenProperty: string = 'token';

    constructor(scope: cdk.Construct, id: string) {
        super(scope, id);

        this.hsmClusterId = this.createSsmParameter(Config.hsmClusterId, 'CloudHSM Cluster Id');
        this.hsmCustomerCA = this.createSsmParameter(Config.hsmCustomerCA, 'CloudHSM CustomerCA Certificate X.509', '< IMPORT LATER >');
        this.hsmSecret = this.createHsmSecret();

        const hsmInfo = this.importCloudHSMVpc();
        this.hsmVpc = hsmInfo.hsmVpc;
        this.hsmVpcCidr = hsmInfo.hsmVpcCidr;

        this.mtlsKeyLabel = this.createSsmParameter(Config.mtlsKeyLabel, 'mTLS Private Key Label in CloudHSM');
        this.mtlsCertificate = this.createSsmParameter(Config.mtlsCertificate, 'mTLS Certificate X.509', '< IMPORT LATER >');

        this.signatureKeyLabel = this.createSsmParameter(Config.signatureKeyLabel, 'Signature Private Key Label in CloudHSM');
        this.signatureCertificate = this.createSsmParameter(Config.signatureCertificate, 'Signature Certificate X.509', '< IMPORT LATER >');

        this.bcbMtlsCertificate = this.createSsmParameter(Config.bcbMtlsCertificate, 'BCB mTLS Certificate X.509', '< IMPORT LATER >');
        this.bcbSignatureCertificate = this.createSsmParameter(Config.bcbSignatureCertificate, 'BCB Signature Certificate X.509', '< IMPORT LATER >');
        this.bcbDictEndpoint = this.createSsmParameter(Config.bcbDictEndpoint, 'BCB Dict Endpoint (hostname and optional port). Example: x.pi.rsfn.net.br or x.pi.rsfn.net.br:443', 'test.pi.rsfn.net.br:8181');
        this.bcbSpiEndpoint = this.createSsmParameter(Config.bcbSpiEndpoint, 'BCB Spi Endpoint (hostname and optional port). Example: x.pi.rsfn.net.br or x.pi.rsfn.net.br:443', 'test.pi.rsfn.net.br:9191');

        this.gitHubSecret = this.createGitHubSecret();
    }

    private createSsmParameter(id: string, description: string, defaultValue?: string): ssm.StringParameter {
        let input = new cdk.CfnParameter(this, id, {
            type: 'String',
            description: description,
            default: defaultValue,
            allowedPattern: '.+'
        });
        input.overrideLogicalId(id);

        let ssmParameter = new ssm.StringParameter(this, `${id}Param`, {
            parameterName: Config.getParameterName(id),
            stringValue: input.valueAsString
        });

        let output = new cdk.CfnOutput(this, `${id}Parameter`, {
            value: ssmParameter.parameterName
        });
        output.overrideLogicalId(`${id}Parameter`);

        return ssmParameter;
    }

    public static getParameterName(paramId: string): string {
        return this.parameterPrefix + paramId;
    }

    private createHsmSecret(): secretsmanager.Secret {
        let username = new cdk.CfnParameter(this, 'CloudHSMUser', {
            type: 'String',
            description: "CloudHSM CU username",
            allowedPattern: '.+',
            noEcho: true
        });
        username.overrideLogicalId('CloudHSMUser');

        let password = new cdk.CfnParameter(this, 'CloudHSMPassword', {
            type: 'String',
            description: "CloudHSM CU password",
            allowedPattern: '.+',
            noEcho: true
        });
        password.overrideLogicalId('CloudHSMPassword');

        let secret = new secretsmanager.Secret(this, 'CloudHSMSecretManager', {
            secretName: Config.getParameterName(Config.hsmSecret),
            generateSecretString: {
                secretStringTemplate: JSON.stringify({
                    HSM_USER: username.valueAsString,
                    HSM_PASSWORD: password.valueAsString
                }),
                generateStringKey: 'RANDOM'
            }
        });

        let output = new cdk.CfnOutput(this, 'CloudHSMSecretARN', {
            value: secret.secretArn
        });
        output.overrideLogicalId('CloudHSMSecretARN');

        return secret;
    }

    private createGitHubSecret(): secretsmanager.Secret {
        let token = new cdk.CfnParameter(this, 'GitHubToken', {
            type: 'String',
            description: "GitHub OAuth Token",
            allowedPattern: '.+',
            noEcho: true
        });
        token.overrideLogicalId('GitHubToken');

        let secret = new secretsmanager.Secret(this, 'GitHubSecretManager', {
            secretName: Config.getParameterName(Config.gitHubSecret),
            generateSecretString: {
                secretStringTemplate: JSON.stringify({
                    token: token.valueAsString
                }),
                generateStringKey: 'RANDOM'
            }
        });

        let output = new cdk.CfnOutput(this, 'GitHubSecretARN', {
            value: secret.secretArn
        });
        output.overrideLogicalId('GitHubSecretARN')

        return secret;
    }

    private importCloudHSMVpc() {
        let hsmVpc = new cdk.CfnParameter(this, "CloudHSMVpc", {
            type: "AWS::EC2::VPC::Id",
            description: "CloudHSM VPC",
            allowedPattern: '.+'
        });
        hsmVpc.overrideLogicalId("CloudHSMVpc");

        let hsmVpcOutput = new cdk.CfnOutput(this, 'CloudHSMVpcParameter', {
            value: hsmVpc.valueAsString
        });
        hsmVpcOutput.overrideLogicalId("CloudHSMVpcParameter");

        let hsmVpcCidr = new cdk.CfnParameter(this, "CloudHSMVpcCIDR", {
            description: "CloudHSM VPC CIDR (Provide the CIDR of the CloudHSM VPC you have chosen)",
            allowedPattern: '([0-9]{1,3}\\.){3}[0-9]{1,3}(\\/([0-9]|[1-2][0-9]|3[0-2]))'
        });
        hsmVpcCidr.overrideLogicalId("CloudHSMVpcCIDR");

        let hsmVpcCidrOutput = new cdk.CfnOutput(this, 'CloudHSMVpcCIDRParameter', {
            value: hsmVpcCidr.valueAsString
        });
        hsmVpcCidrOutput.overrideLogicalId("CloudHSMVpcCIDRParameter");

        return {
            hsmVpc: hsmVpc,
            hsmVpcCidr: hsmVpcCidr
        };
    }
}