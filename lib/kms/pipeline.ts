import * as cdk from '@aws-cdk/core';
import { Config } from "./config";
import * as codebuild from "@aws-cdk/aws-codebuild";
import * as codepipeline from "@aws-cdk/aws-codepipeline";
import * as codepipeline_actions from "@aws-cdk/aws-codepipeline-actions";
import * as lambda from '@aws-cdk/aws-lambda';
import { Base } from "./base";
import * as testBase from "../test/base";


export interface PipelineProps {
    readonly config: Config;
    readonly base: Base;
    readonly lambdaCode: lambda.CfnParametersCode;
    readonly testBase: testBase.Base;
}

export class Pipeline extends cdk.Construct {

    private readonly props: PipelineProps;

    private readonly gitHubOwner: string = 'aws-samples';
    private readonly gitHubRepo: string = 'pix-proxy-samples';

    private readonly gitHubKmsJceOwner: string = 'aws-samples';
    private readonly gitHubKmsJceRepo: string = 'aws-kms-jce';

    private readonly gitHubCdkOwner: string = 'llins';
    private readonly gitHubCdkRepo: string = 'pix-proxy-samples-cdk';

    readonly pipeline: codepipeline.Pipeline;

    constructor(scope: cdk.Construct, id: string, props: PipelineProps) {
        super(scope, id);

        this.props = props;
        this.pipeline = this.createPipeline();
    }

    private createPipeline(): codepipeline.Pipeline {
        let sourceOutput = new codepipeline.Artifact();
        let kmsJceSourceOutput = new codepipeline.Artifact('kmsJce');
        let cdkSourceOutput = new codepipeline.Artifact();
        let lambdaFunctionBuildOutput = new codepipeline.Artifact('LambdaFunctionBuildOutput');
        let testContainerImageBuildOutput = new codepipeline.Artifact('TestContainerImageBuildOutput');

        let pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
            stages: [
                this.createSourceStage(sourceOutput, kmsJceSourceOutput, cdkSourceOutput),
                this.createBuildStage(sourceOutput, kmsJceSourceOutput, lambdaFunctionBuildOutput, testContainerImageBuildOutput),
                this.createManualApprovalStage(),
                this.createClusterStackDeployStage(lambdaFunctionBuildOutput, cdkSourceOutput)
            ]
        });

        let output = new cdk.CfnOutput(this, 'PipelineARN', {
            value: pipeline.pipelineArn
        });
        output.overrideLogicalId('PipelineARN');

        return pipeline;
    }

    private createSourceStage(output: codepipeline.Artifact, kmsJceOutput: codepipeline.Artifact, cdkOutput: codepipeline.Artifact): codepipeline.StageProps {
        const secret = cdk.SecretValue.secretsManager(this.props.config.gitHubSecret.secretArn, {
            jsonField: this.props.config.gitHubSecretTokenProperty
        });

        return {
            stageName: 'Source',
            actions: [
                new codepipeline_actions.GitHubSourceAction({
                    actionName: 'GitHub_Source',
                    trigger: codepipeline_actions.GitHubTrigger.NONE,
                    owner: this.gitHubOwner,
                    repo: this.gitHubRepo,
                    oauthToken: secret,
                    output: output
                }),
                new codepipeline_actions.GitHubSourceAction({
                    actionName: 'GitHub_KmsJceSource',
                    trigger: codepipeline_actions.GitHubTrigger.NONE,
                    owner: this.gitHubKmsJceOwner,
                    repo: this.gitHubKmsJceRepo,
                    oauthToken: secret,
                    output: kmsJceOutput
                }),
                new codepipeline_actions.GitHubSourceAction({
                    actionName: 'GitHub_Cdk',
                    trigger: codepipeline_actions.GitHubTrigger.NONE,
                    owner: this.gitHubCdkOwner,
                    repo: this.gitHubCdkRepo,
                    oauthToken: secret,
                    output: cdkOutput
                })
            ]
        };
    }

    private createBuildStage(input: codepipeline.Artifact, inputKmsJce: codepipeline.Artifact, output: codepipeline.Artifact, testOutput: codepipeline.Artifact): codepipeline.StageProps {
        let project = new codebuild.PipelineProject(this, 'LambdaFunctionBuild', {
            buildSpec: this.createBuildSpec(inputKmsJce),
            environment: {
                buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_3,
                privileged: true,
                computeType: codebuild.ComputeType.MEDIUM
            }
        });

        return {
            stageName: 'Build',
            actions: [
                new codepipeline_actions.CodeBuildAction({
                    actionName: 'LambdaFunction_Build',
                    project: project,
                    input: input,
                    extraInputs: [inputKmsJce],
                    outputs: [output]
                }),
                this.props.testBase.createBuildAction(input, testOutput)
            ],
        }
    }

    private createBuildSpec(inputKmsJce: codepipeline.Artifact): codebuild.BuildSpec {
        return codebuild.BuildSpec.fromObject({
            version: '0.2',
            phases: {
                install: {
                    'runtime-versions': {
                        'java': 'corretto11'
                    },
                    commands: [
                        'java -version',
                        'mvn -version',
                        'aws --version'
                    ],
                },
                build: {
                    commands: [
                        `cd $CODEBUILD_SRC_DIR_${inputKmsJce.artifactName}`,
                        'mvn clean install -DskipTests',
                        'cd $CODEBUILD_SRC_DIR',
                        'mvn -f proxy/pom.xml -pl core,kms clean package -DskipTests -Pnative -Dnative-image.docker-build=true'
                    ]
                }
            },
            artifacts: {
                'base-directory': '$CODEBUILD_SRC_DIR/proxy/kms/target',
                files: [
                    'bootstrap'
                ]
            }
        });
    }

    private createManualApprovalStage(): codepipeline.StageProps {
        return {
            stageName: 'Approval',
            actions: [
                new codepipeline_actions.ManualApprovalAction({
                    actionName: 'ManualApproval',
                    additionalInformation: 'Attention! Continue only if you have imported all the necessary certificates!'
                })
            ]
        };
    }

    private createClusterStackDeployStage(input: codepipeline.Artifact, cdkInput: codepipeline.Artifact): codepipeline.StageProps {
        return {
            stageName: 'LambdaStack',
            actions: [
                new codepipeline_actions.CloudFormationCreateUpdateStackAction({
                    actionName: 'Deploy',
                    stackName: 'Pix-Proxy-KMS-Lambda',
                    adminPermissions: true,
                    templatePath: cdkInput.atPath('cdk.out/Pix-Proxy-KMS-Lambda.template.json'),
                    parameterOverrides: {
                        ...this.props.lambdaCode.assign(input.s3Location),
                    },
                    extraInputs: [input],
                })
            ]
        };
    }

}