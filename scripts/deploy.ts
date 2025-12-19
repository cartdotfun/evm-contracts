/**
 * Complete Trust Layer Deployment Script
 * 
 * Deploys ALL contracts in the correct order:
 * 1. TrustEngine - Core balance management
 * 2. IdentityRegistry - Agent identity NFTs
 * 3. ReputationRegistry - On-chain feedback
 * 4. ValidationBridge - Connects TrustEngine to ERC-8004
 * 5. GatewaySession - x402 payment sessions
 * 
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network base-sepolia
 */

import { ethers, network } from "hardhat";

async function main() {
    console.log(`\n🚀 Deploying Cart Protocol to ${network.name}...\n`);
    console.log("═".repeat(60));

    const [deployer] = await ethers.getSigners();
    console.log(`Deployer: ${deployer.address}`);
    console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

    // 1. Deploy TrustEngine
    console.log("1️⃣  Deploying TrustEngine...");
    const TrustEngine = await ethers.getContractFactory("TrustEngine");
    const trustEngine = await TrustEngine.deploy(deployer.address);
    await trustEngine.waitForDeployment();
    const trustEngineAddress = await trustEngine.getAddress();
    console.log(`   ✅ TrustEngine: ${trustEngineAddress}\n`);

    // 2. Deploy IdentityRegistry
    console.log("2️⃣  Deploying IdentityRegistry...");
    const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
    const identityRegistry = await IdentityRegistry.deploy(deployer.address);
    await identityRegistry.waitForDeployment();
    const identityRegistryAddress = await identityRegistry.getAddress();
    console.log(`   ✅ IdentityRegistry: ${identityRegistryAddress}\n`);

    // 3. Deploy ReputationRegistry
    console.log("3️⃣  Deploying ReputationRegistry...");
    const ReputationRegistry = await ethers.getContractFactory("ReputationRegistry");
    const reputationRegistry = await ReputationRegistry.deploy(
        identityRegistryAddress,
        deployer.address
    );
    await reputationRegistry.waitForDeployment();
    const reputationRegistryAddress = await reputationRegistry.getAddress();
    console.log(`   ✅ ReputationRegistry: ${reputationRegistryAddress}\n`);

    // 4. Deploy ValidationBridge
    console.log("4️⃣  Deploying ValidationBridge...");
    const ValidationBridge = await ethers.getContractFactory("ValidationBridge");
    const validationBridge = await ValidationBridge.deploy(
        trustEngineAddress,
        identityRegistryAddress,
        deployer.address
    );
    await validationBridge.waitForDeployment();
    const validationBridgeAddress = await validationBridge.getAddress();
    console.log(`   ✅ ValidationBridge: ${validationBridgeAddress}\n`);

    // 5. Deploy GatewaySession
    console.log("5️⃣  Deploying GatewaySession...");
    const GatewaySession = await ethers.getContractFactory("GatewaySession");
    const gatewaySession = await GatewaySession.deploy(trustEngineAddress, deployer.address);
    await gatewaySession.waitForDeployment();
    const gatewaySessionAddress = await gatewaySession.getAddress();
    console.log(`   ✅ GatewaySession: ${gatewaySessionAddress}\n`);

    // 6. Configure TrustEngine
    console.log("6️⃣  Configuring TrustEngine...");
    await (await trustEngine.setValidationBridge(validationBridgeAddress)).wait();
    await (await trustEngine.setGatewaySession(gatewaySessionAddress)).wait();
    await (await trustEngine.setArbiter(deployer.address)).wait();
    await (await trustEngine.setProtocolFee(25)).wait(); // 0.25%
    await (await trustEngine.setProtocolFeeRecipient(deployer.address)).wait();
    console.log(`   ✅ All configurations set\n`);

    // Summary
    console.log("═".repeat(60));
    console.log("        🎉 DEPLOYMENT COMPLETE 🎉");
    console.log("═".repeat(60));
    console.log(`Network:            ${network.name}`);
    console.log(`TrustEngine:        ${trustEngineAddress}`);
    console.log(`IdentityRegistry:   ${identityRegistryAddress}`);
    console.log(`ReputationRegistry: ${reputationRegistryAddress}`);
    console.log(`ValidationBridge:   ${validationBridgeAddress}`);
    console.log(`GatewaySession:     ${gatewaySessionAddress}`);
    console.log("═".repeat(60) + "\n");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Deployment failed:", error);
        process.exit(1);
    });
