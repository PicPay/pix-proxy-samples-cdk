# PIX Proxy Samples CDK - CloudHSM

<p align="center">
  <img src="/images/proxy-cloudhsm.png">
</p>

## Pré-requisito

1. Criar o ClusterHSM
2. Criar a chave, label e certificado digital para assinatura digital. [Veja aqui](https://github.com/aws-samples/pix-proxy-samples/blob/master/README-CloudHSM.md#generate-keys-and-certificate-to-digital-signature)
3. Criar a chave, label e certificado digital para o mTLS. [Veja aqui](https://github.com/aws-samples/pix-proxy-samples/blob/master/README-CloudHSM.md#generate-keys-and-certificate-to-mtls)


## Realizando o Deploy

1. Crie uma nova Stack no CloudFormation realizando o upload do template [cdk.out/Pix-Proxy-CloudHSM.template.json](/cdk.out/Pix-Proxy-CloudHSM.template.json).
    
    1. Informe o nome da stack: `Pix-Proxy-CloudHSM`
    2. Mais informações sobre os parâmetros pode ser visto [aqui](https://github.com/aws-samples/pix-proxy-samples/blob/master/README-CloudHSM.md#aws-systems-manager-parameter-store). MAS NÃO É NECESSÁRIO CRIAR NENHUM PARÂMETRO MANUALMENTE.
    3. Os parâmetros com o valor `< IMPORT LATER >`, deverão ser informados posteriormente. Ignore-os por enquanto.
    4. Informe a VPC onde o CloudHSM está e, também, o CIDR da VPC do CloudHSM. O Proxy criará uma VPC com o CIDR `172.29.0.0/16`. Não poderá chocar com o CIDR!
    5. É necessário criar e informar o token do GitHub para que o CodePipeline consiga realizar o download do código. [Veja aqui como criar](https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token). Informe as permissões: `admin:repo_hook` e `repo`.

2.  Após criar a stack:

    1. Informe os parâmetros dos certificados digitais. [Veja aqui](https://github.com/aws-samples/pix-proxy-samples/blob/master/README-CloudHSM.md#aws-systems-manager-parameter-store). São os parâmetros que estavam com o valor `< IMPORT LATER >`.
    2. A comunicação com o CloudHSM é feita via VPC Peering. Um lado do Peering já foi realizado (lado do Proxy), mas é necessário atualizar o Route Table na VPC do CloudHSM.
    3. É necessário alterar o Security Group do CloudHSM para permitir a comunicação vindo da VPC do Proxy. (`Protocol: TCP`, `Port Range: 2223 - 2225`, `Source: 172.29.0.0/16`).

3. Quando a Stack foi criada, um Pipeline no CodePipeline foi criado e iniciado automaticamente. Neste pipeline existe um passo manual que deve ser aprovado **APENAS** quando o passo anterior for finalizado por completo.

4. Após o Pipeline finalizar com sucesso, o serviço do Proxy e do Simulador estarão disponíveis.

    1. Foi criado um ALB que expõe o Proxy para o SPI na porta `9090` e para o DICT na porta `8080`.
    2. Foi criado um NLS que expões o Simulado para o SPI na porta `9191` e para o DICT na porta `8181`.
