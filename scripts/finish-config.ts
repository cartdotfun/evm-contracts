import { ethers } from "hardhat";
import {
  readDeployment,
  requireDeployedAddress,
  getNetworkFromEnv,
} from "./lib/deployments";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DELAY_MS = 5000;

async function main() {
  const deployment = readDeployment(getNetworkFromEnv());
  const [deployer] = await ethers.getSigners();
  console.log(
    "Configuring contracts on",
    deployment.network,
    "with account:",
    deployer.address,
  );

  const trustEngineAddr = requireDeployedAddress(
    deployment.contracts.trustEngine,
    "TrustEngine",
  );
  const identityRegistryAddr = requireDeployedAddress(
    deployment.contracts.identityRegistry,
    "IdentityRegistry",
  );
  const reputationRegistryAddr = requireDeployedAddress(
    deployment.contracts.reputationRegistry,
    "ReputationRegistry",
  );
  const validationBridgeAddr = requireDeployedAddress(
    deployment.contracts.validationBridge,
    "ValidationBridge",
  );
  const gatewaySessionAddr = requireDeployedAddress(
    deployment.contracts.gatewaySession,
    "GatewaySession",
  );
  const usdcAddr = deployment.tokens.usdc;

  const TrustEngine = await ethers.getContractFactory("TrustEngine");
  const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
  const ReputationRegistry = await ethers.getContractFactory(
    "ReputationRegistry",
  );
  const ValidationBridge = await ethers.getContractFactory("ValidationBridge");
  const GatewaySession = await ethers.getContractFactory("GatewaySession");

  const trustEngine = TrustEngine.attach(trustEngineAddr);
  const identityRegistry = IdentityRegistry.attach(identityRegistryAddr);
  const reputationRegistry = ReputationRegistry.attach(reputationRegistryAddr);
  const validationBridge = ValidationBridge.attach(validationBridgeAddr);
  const gatewaySession = GatewaySession.attach(gatewaySessionAddr);

  // 1. Set Protocol Fee
  console.log("Setting Protocol Fees...");
  try {
    const tx = await trustEngine.setProtocolFee(200); // 2%
    console.log("Tx sent:", tx.hash);
    await tx.wait();
    console.log("Protocol fee set.");
  } catch (e: any) {
    console.log("Skipping protocol fee (or failed):", e.message);
  }
  await delay(DELAY_MS);

  // 3. Set Staking Token on IdentityRegistry
  console.log("Setting Staking Token on IdentityRegistry...");
  try {
    const tx = await identityRegistry.setStakingToken(usdcAddr);
    console.log("Tx sent:", tx.hash);
    await tx.wait();
    console.log("Staking token set on IdentityRegistry.");
  } catch (e: any) {
    console.log(
      "Skipping IdentityRegistry staking token (or failed):",
      e.message,
    );
  }
  await delay(DELAY_MS);

  // 4. ReputationRegistry configuration (IdentityRegistry is set in initialize)
  // No specific setTrustEngine on ReputationRegistry

  // 5. Set TrustEngine on ValidationBridge
  console.log("Setting TrustEngine on ValidationBridge...");
  try {
    const tx = await validationBridge.setTrustEngine(trustEngineAddr);
    console.log("Tx sent:", tx.hash);
    await tx.wait();
    console.log("ValidationBridge wired.");
  } catch (e: any) {
    console.log("Skipping ValidationBridge (or failed):", e.message);
  }
  await delay(DELAY_MS);

  // 6. Ensure TrustEngine knows about ValidationBridge and GatewaySession
  console.log("Ensuring TrustEngine permissions...");
  try {
    // We can't easily check if it's already set without a getter, but setValidationBridge is idempotent-ish
    const tx1 = await trustEngine.setValidationBridge(validationBridgeAddr);
    await tx1.wait();
    console.log("ValidationBridge set on TrustEngine.");
    await delay(DELAY_MS);

    const tx2 = await trustEngine.setGatewaySession(gatewaySessionAddr);
    await tx2.wait();
    console.log("GatewaySession set on TrustEngine.");
  } catch (e: any) {
    console.log("Skipping permissions (or failed):", e.message);
  }

  console.log("Configuration complete!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
