
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TrustEngine Protocol Fees", function () {
    let TrustEngine;
    let trustEngine;
    let MockERC20;
    let token;
    let owner;
    let agent;
    let provider;
    let feeRecipient;
    let gatewaySession;

    const INITIAL_BALANCE = ethers.parseEther("1000");
    const DEPOSIT_AMOUNT = ethers.parseEther("100");
    const USED_AMOUNT = ethers.parseEther("10");
    const FEE_BPS = 500; // 5%

    beforeEach(async function () {
        [owner, agent, provider, feeRecipient, gatewaySession] = await ethers.getSigners();

        // Deploy Mock Token
        MockERC20 = await ethers.getContractFactory("MockERC20");
        token = await MockERC20.deploy("USD Coin", "USDC");
        await token.waitForDeployment();

        // Mint tokens to agent
        await token.mint(agent.address, INITIAL_BALANCE);

        // Deploy TrustEngine
        TrustEngine = await ethers.getContractFactory("TrustEngine");
        trustEngine = await TrustEngine.deploy(owner.address);
        await trustEngine.waitForDeployment();

        // Setup Fee
        await trustEngine.setProtocolFee(FEE_BPS);
        await trustEngine.setProtocolFeeRecipient(feeRecipient.address);

        // Approve TrustEngine
        await token.connect(agent).approve(await trustEngine.getAddress(), INITIAL_BALANCE);

        // Deposit to TrustEngine
        await trustEngine.connect(agent).deposit(await token.getAddress(), DEPOSIT_AMOUNT);
    });

    it("should collect fee on session unlock", async function () {
        const sessionId = ethers.keccak256(ethers.toUtf8Bytes("session1"));

        // Set GatewaySession for testing internal calls
        await trustEngine.setGatewaySession(gatewaySession.address);

        // Lock funds (as GatewaySession)
        await trustEngine.connect(gatewaySession).lockForSession(
            sessionId,
            agent.address,
            provider.address,
            await token.getAddress(),
            DEPOSIT_AMOUNT
        );

        // Unlock with usage (as GatewaySession)
        await expect(trustEngine.connect(gatewaySession).unlockSession(sessionId, USED_AMOUNT))
            .to.emit(trustEngine, "ProtocolFeeCollected")
            .withArgs(sessionId, await token.getAddress(), (USED_AMOUNT * BigInt(FEE_BPS)) / 10000n);

        // Check balances
        const providerBalance = await trustEngine.balances(provider.address, await token.getAddress());
        const feeRecipientBalance = await trustEngine.balances(feeRecipient.address, await token.getAddress());

        const expectedFee = (USED_AMOUNT * BigInt(FEE_BPS)) / 10000n;
        const expectedProviderAmount = USED_AMOUNT - expectedFee;

        expect(providerBalance).to.equal(expectedProviderAmount);
        expect(feeRecipientBalance).to.equal(expectedFee);
    });

    it("should collect fee on deal release", async function () {
        const dealId = ethers.keccak256(ethers.toUtf8Bytes("deal1"));

        // Create deal
        await trustEngine.connect(agent).createDeal(
            dealId,
            provider.address,
            await token.getAddress(),
            DEPOSIT_AMOUNT,
            "0x",
            ethers.ZeroHash,
            0
        );

        // Release deal
        await expect(trustEngine.connect(agent).release(dealId))
            .to.emit(trustEngine, "ProtocolFeeCollected")
            .withArgs(dealId, await token.getAddress(), (DEPOSIT_AMOUNT * BigInt(FEE_BPS)) / 10000n);

        const providerBalance = await trustEngine.balances(provider.address, await token.getAddress());
        const feeRecipientBalance = await trustEngine.balances(feeRecipient.address, await token.getAddress());

        const expectedFee = (DEPOSIT_AMOUNT * BigInt(FEE_BPS)) / 10000n;
        expect(feeRecipientBalance).to.equal(expectedFee);
        expect(providerBalance).to.equal(DEPOSIT_AMOUNT - expectedFee);
    });

    it("should collect fee on dispute resolution (to seller)", async function () {
        const dealId = ethers.keccak256(ethers.toUtf8Bytes("deal2"));

        // Create deal
        await trustEngine.connect(agent).createDeal(
            dealId,
            provider.address,
            await token.getAddress(),
            DEPOSIT_AMOUNT,
            "0x",
            ethers.ZeroHash,
            0
        );

        // Raise Dispute
        await trustEngine.connect(agent).raiseDispute(dealId);

        // Set Arbiter
        await trustEngine.setArbiter(owner.address);

        // Resolve to Seller
        await expect(trustEngine.connect(owner).resolveDispute(dealId, true, "cid"))
            .to.emit(trustEngine, "ProtocolFeeCollected");

        const providerBalance = await trustEngine.balances(provider.address, await token.getAddress());
        const feeRecipientBalance = await trustEngine.balances(feeRecipient.address, await token.getAddress());

        const expectedFee = (DEPOSIT_AMOUNT * BigInt(FEE_BPS)) / 10000n;
        expect(feeRecipientBalance).to.equal(expectedFee);
        expect(providerBalance).to.equal(DEPOSIT_AMOUNT - expectedFee);
    });

    it("should NOT collect fee on dispute resolution (to buyer)", async function () {
        const dealId = ethers.keccak256(ethers.toUtf8Bytes("deal3"));

        // Create deal
        await trustEngine.connect(agent).createDeal(
            dealId,
            provider.address,
            await token.getAddress(),
            DEPOSIT_AMOUNT,
            "0x",
            ethers.ZeroHash,
            0
        );

        // Raise Dispute
        await trustEngine.connect(agent).raiseDispute(dealId);

        // Set Arbiter
        await trustEngine.setArbiter(owner.address);

        // Resolve to Buyer
        await expect(trustEngine.connect(owner).resolveDispute(dealId, false, "cid"))
            .not.to.emit(trustEngine, "ProtocolFeeCollected");

        const feeRecipientBalance = await trustEngine.balances(feeRecipient.address, await token.getAddress());
        expect(feeRecipientBalance).to.equal(0);
    });

    it("should collect fee on Solana settlement", async function () {
        const sessionId = ethers.keccak256(ethers.toUtf8Bytes("sol_session1"));

        // Setup Solana Relay
        await trustEngine.setSolanaRelay(gatewaySession.address); // Using gatewaySession signer as mock relay
        await trustEngine.setSolanaSessionToken(await token.getAddress());

        // Settle from Solana
        await expect(trustEngine.connect(gatewaySession).settleFromSolana(
            sessionId,
            agent.address,
            provider.address,
            USED_AMOUNT
        ))
            .to.emit(trustEngine, "ProtocolFeeCollected")
            .withArgs(sessionId, await token.getAddress(), (USED_AMOUNT * BigInt(FEE_BPS)) / 10000n);

        const providerBalance = await trustEngine.balances(provider.address, await token.getAddress());
        const feeRecipientBalance = await trustEngine.balances(feeRecipient.address, await token.getAddress());

        const expectedFee = (USED_AMOUNT * BigInt(FEE_BPS)) / 10000n;
        expect(feeRecipientBalance).to.equal(expectedFee);
        expect(providerBalance).to.equal(USED_AMOUNT - expectedFee);
    });

});
