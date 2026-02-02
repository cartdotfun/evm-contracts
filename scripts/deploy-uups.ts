import "@nomicfoundation/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";
import hre from "hardhat";
import {
  getNetworkFromHardhatName,
  readDeployment,
  writeDeployment,
} from "./lib/deployments";

async function main() {
  const { ethers, upgrades } = hre;
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  const network = getNetworkFromHardhatName(hre.network.name);
  const existing = readDeployment(network);

  const delay = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const DELAY_MS = 5000;

  // 1. Deploy CartToken (Standard ERC20, not upgradeable)
  console.log("Deploying CartToken...");
  const CartToken = await ethers.getContractFactory("CartToken");
  const cartToken = await CartToken.deploy(deployer.address);
  await cartToken.waitForDeployment();
  const cartTokenAddress = await cartToken.getAddress();
  console.log("CartToken deployed to:", cartTokenAddress);
  await delay(DELAY_MS);

  // 2. Deploy IdentityRegistry (UUPS)
  console.log("Deploying IdentityRegistry (UUPS)...");
  const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
  const identityRegistry = await upgrades.deployProxy(
    IdentityRegistry,
    [deployer.address, cartTokenAddress],
    {
      initializer: "initialize",
      kind: "uups",
    },
  );
  await identityRegistry.waitForDeployment();
  const identityRegistryAddress = await identityRegistry.getAddress();
  console.log("IdentityRegistry deployed to:", identityRegistryAddress);
  await delay(DELAY_MS);

  // 3. Deploy TrustEngine (UUPS)
  console.log("Deploying TrustEngine (UUPS)...");
  const TrustEngine = await ethers.getContractFactory("TrustEngine");
  const trustEngine = await upgrades.deployProxy(
    TrustEngine,
    [deployer.address],
    {
      initializer: "initialize",
      kind: "uups",
    },
  );
  await trustEngine.waitForDeployment();
  const trustEngineAddress = await trustEngine.getAddress();
  console.log("TrustEngine deployed to:", trustEngineAddress);
  await delay(DELAY_MS);

  // 4. Deploy ReputationRegistry (UUPS)
  console.log("Deploying ReputationRegistry (UUPS)...");
  const ReputationRegistry = await ethers.getContractFactory(
    "ReputationRegistry",
  );
  const reputationRegistry = await upgrades.deployProxy(
    ReputationRegistry,
    [identityRegistryAddress, deployer.address],
    {
      initializer: "initialize",
      kind: "uups",
      unsafeAllow: ["constructor"],
    },
  );
  await reputationRegistry.waitForDeployment();
  const reputationRegistryAddress = await reputationRegistry.getAddress();
  console.log("ReputationRegistry deployed to:", reputationRegistryAddress);
  await delay(DELAY_MS);

  // 5. Deploy ValidationBridge (UUPS)
  console.log("Deploying ValidationBridge (UUPS)...");
  const ValidationBridge = await ethers.getContractFactory("ValidationBridge");
  const validationBridge = await upgrades.deployProxy(
    ValidationBridge,
    [trustEngineAddress, identityRegistryAddress, deployer.address],
    {
      initializer: "initialize",
      kind: "uups",
      unsafeAllow: ["constructor"],
    },
  );
  await validationBridge.waitForDeployment();
  const validationBridgeAddress = await validationBridge.getAddress();
  console.log("ValidationBridge deployed to:", validationBridgeAddress);
  await delay(DELAY_MS);

  // 6. Deploy GatewaySession (UUPS)
  console.log("Deploying GatewaySession (UUPS)...");
  const GatewaySession = await ethers.getContractFactory("GatewaySession");
  const gatewaySession = await upgrades.deployProxy(
    GatewaySession,
    [trustEngineAddress, deployer.address],
    {
      initializer: "initialize",
      kind: "uups",
    },
  );
  await gatewaySession.waitForDeployment();
  const gatewaySessionAddress = await gatewaySession.getAddress();
  console.log("GatewaySession deployed to:", gatewaySessionAddress);
  await delay(DELAY_MS);

  // 7. Post-Deployment Configuration
  console.log("Configuring contracts...");

  // Link TrustEngine to ValidationBridge
  console.log("Setting ValidationBridge on TrustEngine...");
  const tx1 = await trustEngine.setValidationBridge(validationBridgeAddress);
  await tx1.wait();

  // Link TrustEngine to GatewaySession
  console.log("Setting GatewaySession on TrustEngine...");
  const tx2 = await trustEngine.setGatewaySession(gatewaySessionAddress);
  await tx2.wait();

  // Set Protocol Fees (Example: 1% fee to deployer)
  console.log("Setting Protocol Fees...");
  const tx3 = await trustEngine.setProtocolFee(100); // 1%
  await tx3.wait();
  const tx4 = await trustEngine.setProtocolFeeRecipient(deployer.address);
  await tx4.wait();

  // Set Initial Arbiter (Deployer for now)
  console.log("Setting Arbiter...");
  const tx5 = await trustEngine.setArbiter(deployer.address);
  await tx5.wait();

  console.log("\nDeployment Complete!");
  console.log("----------------------------------------------------");
  console.log("CartToken:         ", cartTokenAddress);
  console.log("IdentityRegistry:  ", identityRegistryAddress);
  console.log("TrustEngine:       ", trustEngineAddress);
  console.log("ReputationRegistry:", reputationRegistryAddress);
  console.log("ValidationBridge:  ", validationBridgeAddress);
  console.log("GatewaySession:    ", gatewaySessionAddress);
  console.log("----------------------------------------------------");

  writeDeployment(network, {
    ...existing,
    contracts: {
      cartToken: cartTokenAddress as `0x${string}`,
      identityRegistry: identityRegistryAddress as `0x${string}`,
      trustEngine: trustEngineAddress as `0x${string}`,
      reputationRegistry: reputationRegistryAddress as `0x${string}`,
      validationBridge: validationBridgeAddress as `0x${string}`,
      gatewaySession: gatewaySessionAddress as `0x${string}`,
    },
    tokens: existing.tokens,
  });

  // Optional: Verify on Etherscan (if API key provided)
  // await hre.run("verify:verify", { address: cartTokenAddress, constructorArguments: [deployer.address] });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
