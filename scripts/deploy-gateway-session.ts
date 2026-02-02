/**
 * Deploy GatewaySession Only
 * 
 * Deploys just the GatewaySession contract (e.g., after adding sync-relayer feature)
 * and connects it to the existing TrustEngine.
 * 
 * Usage:
 *   npx hardhat run scripts/deploy-gateway-session.ts --network base-sepolia
 * 
 * Requires TRUST_ENGINE_ADDRESS environment variable to be set.
 */

import { ethers, network } from "hardhat";

async function main() {
    console.log(`\n🚀 Deploying GatewaySession to ${network.name}...\n`);
    console.log("═".repeat(60));

    // Get existing TrustEngine address
    const trustEngineAddress = process.env.TRUST_ENGINE_ADDRESS;
    if (!trustEngineAddress) {
        throw new Error("TRUST_ENGINE_ADDRESS environment variable required");
    }

    const [deployer] = await ethers.getSigners();
    console.log(`Deployer:     ${deployer.address}`);
    console.log(`Balance:      ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
    console.log(`TrustEngine:  ${trustEngineAddress}\n`);

    // Deploy GatewaySession
    console.log("1️⃣  Deploying GatewaySession...");
    const GatewaySession = await ethers.getContractFactory("GatewaySession");
    const gatewaySession = await GatewaySession.deploy(trustEngineAddress, deployer.address);
    await gatewaySession.waitForDeployment();
    const gatewaySessionAddress = await gatewaySession.getAddress();
    console.log(`   ✅ GatewaySession: ${gatewaySessionAddress}\n`);

    // Update TrustEngine to point to new GatewaySession
    console.log("2️⃣  Updating TrustEngine.setGatewaySession()...");
    const TrustEngine = await ethers.getContractFactory("TrustEngine");
    const trustEngine = TrustEngine.attach(trustEngineAddress);
    const tx = await trustEngine.setGatewaySession(gatewaySessionAddress);
    await tx.wait();
    console.log(`   ✅ TrustEngine now points to new GatewaySession\n`);

    // Summary
    console.log("═".repeat(60));
    console.log("        🎉 DEPLOYMENT COMPLETE 🎉");
    console.log("═".repeat(60));
    console.log(`Network:         ${network.name}`);
    console.log(`TrustEngine:     ${trustEngineAddress} (existing)`);
    console.log(`GatewaySession:  ${gatewaySessionAddress} (NEW)`);
    console.log("═".repeat(60));
    console.log("\n⚠️  UPDATE YOUR .env FILES:");
    console.log(`   GATEWAY_SESSION_ADDRESS=${gatewaySessionAddress}`);
    console.log("");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Deployment failed:", error);
        process.exit(1);
    });
