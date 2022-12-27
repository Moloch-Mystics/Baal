exports.deployments = [
  {
    version: "1.0.1",
    networks: ["mainnet", "gnosischain", "goerli", "polygon"],
    deployer: "0x0fe28D4424E2bB251CE3d463Cd60b7F4874Bc42b",
    addresses: {
      lootSingleton: "0x0444AE984b9563C8480244693ED65F25B3C64a4E",
      sharesSingleton: "0x8124Cbb807A7b64123F3dEc3EF64995d8B10d3Eb",
      baalSingleton: "0x5DcE1044A7E2E35D6524001796cee47252f18411",
      factory: "0x7e988A9db2F8597735fc68D21060Daed948a3e8C",
      valutFactory: "0x594E630efbe8dbd810c168e3878817a4094bB312",
      tributeMinion: "0x5c17BFBaB751C5ddF1Ff267acF8fF919537F39Cf",
    },
  },
];
