import hre from "hardhat";
import { getNetworkFromHardhatName, readDeployment, requireDeployedAddress } from "./lib/deployments";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
    const { ethers } = hre;
    const [deployer] = await ethers.getSigners();
    console.log(`Configuring TrustEngine with deployer: ${deployer.address}`);

    const network = getNetworkFromHardhatName(hre.network.name);
    const deployment = readDeployment(network);
    const trustEngineAddress = requireDeployedAddress(deployment.contracts.trustEngine, "TrustEngine");
    const validationBridgeAddress = requireDeployedAddress(deployment.contracts.validationBridge, "ValidationBridge");
    const gatewaySessionAddress = requireDeployedAddress(deployment.contracts.gatewaySession, "GatewaySession");

    const TrustEngine = await ethers.getContractFactory("TrustEngine");
    const trustEngine = TrustEngine.attach(trustEngineAddress);

    console.log("Setting ValidationBridge...");
    try {
        const tx1 = await trustEngine.setValidationBridge(validationBridgeAddress);
        await tx1.wait();
        console.log("✅ ValidationBridge set");
    } catch (e) {
        console.log("⚠️ Failed to set ValidationBridge (maybe already set or nonce issue):", e);
    }
    await sleep(5000);

    console.log("Setting GatewaySession...");
    try {
        const tx2 = await trustEngine.setGatewaySession(gatewaySessionAddress);
        await tx2.wait();
        console.log("✅ GatewaySession set");
    } catch (e) {
        console.log("⚠️ Failed to set GatewaySession:", e);
    }
    await sleep(5000);

    console.log("Setting Arbiter...");
    try {
        const tx3 = await trustEngine.setArbiter(deployer.address);
        await tx3.wait();
        console.log("✅ Arbiter set");
    } catch (e) {
        console.log("⚠️ Failed to set Arbiter:", e);
    }
    await sleep(5000);

    console.log("Setting Protocol Fee...");
    try {
        const tx4 = await trustEngine.setProtocolFee(25);
        await tx4.wait();
        console.log("✅ Protocol Fee set");
    } catch (e) {
        console.log("⚠️ Failed to set Protocol Fee:", e);
    }
    await sleep(5000);

    console.log("Setting Protocol Fee Recipient...");
    try {
        const tx5 = await trustEngine.setProtocolFeeRecipient(deployer.address);
        await tx5.wait();
        console.log("✅ Protocol Fee Recipient set");
    } catch (e) {
        console.log("⚠️ Failed to set Protocol Fee Recipient:", e);
    }

    console.log("🎉 Configuration Complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
