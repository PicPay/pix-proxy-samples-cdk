import * as cdk from "@aws-cdk/core";
import * as ssm from "@aws-cdk/aws-ssm";
import * as secretsmanager from "@aws-cdk/aws-secretsmanager";

export class Config extends cdk.Construct {

    static readonly parameterPrefix: string = '/pix/proxy/kms/';

    static readonly dictAuditStream:string = Config.getParameterName('DictAuditStream');
    static readonly spiAuditStream:string = Config.getParameterName('SpiAuditStream');
    
    readonly mtlsPrivateKey: secretsmanager.Secret;
    static readonly mtlsPrivateKey: string = 'MtlsPrivateKey';
        
    readonly mtlsCertificate: ssm.StringParameter;
    static readonly mtlsCertificate: string = 'MtlsCertificate';

    readonly signatureKeyId: ssm.StringParameter;
    static readonly SignatureKeyId: string = 'SignatureKeyId';

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

        this.mtlsPrivateKey = this.createMtlsPrivateKey();
        this.mtlsCertificate = this.createSsmParameter(Config.mtlsCertificate, 'mTLS Certificate X.509', '< IMPORT LATER >');

        this.signatureKeyId = this.createSsmParameter(Config.SignatureKeyId, 'Signature Private Key Id in KMS');
        this.signatureCertificate = this.createSsmParameter(Config.signatureCertificate, 'Signature Certificate X.509', '< IMPORT LATER >');

        this.bcbMtlsCertificate = this.createSsmParameter(Config.bcbMtlsCertificate, 'BCB mTLS Certificate X.509', '< IMPORT LATER >');
        this.bcbSignatureCertificate = this.createSsmParameter(Config.bcbSignatureCertificate, 'BCB Signature Certificate X.509', '< IMPORT LATER >');
        this.bcbDictEndpoint = this.createSsmParameter(Config.bcbDictEndpoint, 'BCB Dict Endpoint (hostname and optional port). Example: x.pi.rsfn.net.br or x.pi.rsfn.net.br:443', 'test.pi.rsfn.net.br:8181');
        this.bcbSpiEndpoint = this.createSsmParameter(Config.bcbSpiEndpoint, 'BCB Spi Endpoint (hostname and optional port). Example: x.pi.rsfn.net.br or x.pi.rsfn.net.br:443', 'test.pi.rsfn.net.br:9191');

        this.gitHubSecret = this.createGitHubSecret();
    }

    private createMtlsPrivateKey(): secretsmanager.Secret {
        let secret = new secretsmanager.Secret(this, 'MtlsPrivateKeySecretManager', {
            secretName: Config.getParameterName(Config.mtlsPrivateKey)
        });

        let output = new cdk.CfnOutput(this, 'MtlsPrivateKeyARN', {
            value: secret.secretArn
        });
        output.overrideLogicalId('MtlsPrivateKeyARN');

        return secret;
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

    public static getParameterName(paramId: string): string {
        return this.parameterPrefix + paramId;
    }

}