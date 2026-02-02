import { ethers } from "hardhat";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log(`Configuring TrustEngine with deployer: ${deployer.address}`);

    const trustEngineAddress = "0xF449752828DA0EbE57d1987170E524cC37CeE92B";
    const validationBridgeAddress = "0x3C2b41Cd84994705E59886659c661bE1c1562643";
    const gatewaySessionAddress = "0x9D7D78DCF46413AF3846138C342Ea39Ce11F78B8";

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
