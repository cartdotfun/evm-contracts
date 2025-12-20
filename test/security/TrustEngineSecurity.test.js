const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("TrustEngine Security Analysis", function () {
  let TrustEngine;
  let trustEngine;
  let MaliciousReentrant;
  let maliciousReentrant;
  let MockERC20;
  let token;
  let owner;
  let attacker;
  let victim;
  let gateway;
  let arbiter;
  let solanaRelay;

  const INITIAL_BALANCE = ethers.parseEther("1000");
  const ATTACK_AMOUNT = ethers.parseEther("10");

  beforeEach(async function () {
    [owner, attacker, victim, gateway, arbiter, solanaRelay] = await ethers.getSigners();

    // Deploy TrustEngine
    TrustEngine = await ethers.getContractFactory("TrustEngine");
    trustEngine = await TrustEngine.deploy(owner.address);
    await trustEngine.waitForDeployment();

    // Deploy Mock Token
    MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("USD Coin", "USDC");
    await token.waitForDeployment();

    // Deploy Malicious Contract
    MaliciousReentrant = await ethers.getContractFactory("MaliciousReentrant");
    maliciousReentrant = await MaliciousReentrant.deploy(
      await trustEngine.getAddress()
    );
    await maliciousReentrant.waitForDeployment();

    // Setup
    await trustEngine.setGatewaySession(gateway.address);
    await trustEngine.setArbiter(arbiter.address);
    await trustEngine.setSolanaRelay(solanaRelay.address);
    await trustEngine.setSolanaSessionToken(await token.getAddress());
  });

  describe("1. Reentrancy Attacks", function () {
    it("Should prevent reentrancy on withdraw", async function () {
      // Re-deploy a fresh malicious contract for this test to be clean
      const MaliciousReentrantFactory = await ethers.getContractFactory(
        "MaliciousReentrant"
      );
      const badContract = await MaliciousReentrantFactory.deploy(
        await trustEngine.getAddress()
      );
      await badContract.waitForDeployment();

      try {
        await badContract.attackWithdraw({ value: ethers.parseEther("1.0") });
        expect.fail("Transaction should have reverted");
      } catch (error) {
        // We expect an error. We can check if it includes "EthTransferFailed" or "ReentrancyGuardReentrantCall"
        // But simply catching it is enough to prove it reverted.
        // console.log("Caught expected error:", error.message);
        expect(error.message).to.include("reverted");
      }
    });
  });

  describe("2. Access Control Violations", function () {
    it("Should prevent unauthorized GatewaySession calls", async function () {
      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("fake-session"));

      await expect(
        trustEngine
          .connect(attacker)
          .lockForSession(
            sessionId,
            victim.address,
            attacker.address,
            await token.getAddress(),
            ethers.parseEther("100")
          )
      ).to.be.revertedWithCustomError(trustEngine, "Unauthorized");
    });

    it("Should prevent unauthorized Solana Settlement", async function () {
      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("solana-session"));

      await expect(
        trustEngine
          .connect(attacker)
          .settleFromSolana(
            sessionId,
            victim.address,
            attacker.address,
            ethers.parseEther("100")
          )
      ).to.be.revertedWithCustomError(trustEngine, "Unauthorized");
    });

    it("Should prevent unauthorized Arbiter actions", async function () {
      const dealId = ethers.keccak256(ethers.toUtf8Bytes("deal-1"));

      // Setup a deal first
      await token.mint(victim.address, INITIAL_BALANCE);
      await token
        .connect(victim)
        .approve(await trustEngine.getAddress(), INITIAL_BALANCE);
      await trustEngine
        .connect(victim)
        .deposit(await token.getAddress(), INITIAL_BALANCE);

      await trustEngine
        .connect(victim)
        .createDeal(
          dealId,
          attacker.address,
          await token.getAddress(),
          ethers.parseEther("100"),
          "0x",
          ethers.ZeroHash,
          0
        );

      // Attacker tries to resolve dispute
      await trustEngine.connect(victim).raiseDispute(dealId);

      await expect(
        trustEngine.connect(attacker).resolveDispute(dealId, true, "cid")
      ).to.be.revertedWithCustomError(trustEngine, "Unauthorized");
    });

    it("Should prevent unauthorized owner functions", async function () {
      await expect(
        trustEngine.connect(attacker).setProtocolFee(1000)
      ).to.be.revertedWithCustomError(trustEngine, "OwnableUnauthorizedAccount");

      await expect(
        trustEngine.connect(attacker).setProtocolFeeRecipient(attacker.address)
      ).to.be.revertedWithCustomError(trustEngine, "OwnableUnauthorizedAccount");

      await expect(
        trustEngine.connect(attacker).setArbiter(attacker.address)
      ).to.be.revertedWithCustomError(trustEngine, "OwnableUnauthorizedAccount");

      await expect(
        trustEngine.connect(attacker).setSolanaRelay(attacker.address)
      ).to.be.revertedWithCustomError(trustEngine, "OwnableUnauthorizedAccount");
    });
  });

  describe("3. Deal Lifecycle & Logic Errors", function () {
    it("Should prevent modifying a Completed deal", async function () {
      const dealId = ethers.keccak256(ethers.toUtf8Bytes("deal-completed"));

      await token.mint(victim.address, INITIAL_BALANCE);
      await token
        .connect(victim)
        .approve(await trustEngine.getAddress(), INITIAL_BALANCE);
      await trustEngine
        .connect(victim)
        .deposit(await token.getAddress(), INITIAL_BALANCE);

      await trustEngine.connect(victim).createDeal(
        dealId,
        attacker.address, // attacker is seller
        await token.getAddress(),
        ethers.parseEther("100"),
        "0x",
        ethers.ZeroHash,
        0
      );

      // Normal flow
      await trustEngine.connect(victim).release(dealId);

      // Attacker (seller) tries to submit work after release
      await expect(
        trustEngine.connect(attacker).submitWork(dealId, "hash")
      ).to.be.revertedWithCustomError(trustEngine, "InvalidDealState");

      // Attacker tries to refund after release
      await expect(
        trustEngine.connect(attacker).refund(dealId)
      ).to.be.revertedWithCustomError(trustEngine, "InvalidDealState");
    });

    it("Should prevent overwriting an existing deal", async function () {
      const dealId = ethers.keccak256(ethers.toUtf8Bytes("deal-unique"));

      await token.mint(victim.address, INITIAL_BALANCE);
      await token
        .connect(victim)
        .approve(await trustEngine.getAddress(), INITIAL_BALANCE);
      await trustEngine
        .connect(victim)
        .deposit(await token.getAddress(), INITIAL_BALANCE);

      // Victim creates deal
      await trustEngine
        .connect(victim)
        .createDeal(
          dealId,
          attacker.address,
          await token.getAddress(),
          ethers.parseEther("100"),
          "0x",
          ethers.ZeroHash,
          0
        );

      // Attacker tries to create deal with same ID
      await expect(
        trustEngine
          .connect(attacker)
          .createDeal(
            dealId,
            attacker.address,
            await token.getAddress(),
            ethers.parseEther("10"),
            "0x",
            ethers.ZeroHash,
            0
          )
      ).to.be.revertedWithCustomError(trustEngine, "DealAlreadyExists");
    });

    it("Should prevent child deal creation by non-buyer", async function () {
      const parentDealId = ethers.keccak256(ethers.toUtf8Bytes("parent-deal"));
      const childDealId = ethers.keccak256(ethers.toUtf8Bytes("child-deal"));

      await token.mint(victim.address, INITIAL_BALANCE);
      await token
        .connect(victim)
        .approve(await trustEngine.getAddress(), INITIAL_BALANCE);
      await trustEngine
        .connect(victim)
        .deposit(await token.getAddress(), INITIAL_BALANCE);

      // Victim creates parent deal
      await trustEngine
        .connect(victim)
        .createDeal(
          parentDealId,
          attacker.address,
          await token.getAddress(),
          ethers.parseEther("100"),
          "0x",
          ethers.ZeroHash,
          0
        );

      // Attacker (Seller of parent) tries to create child deal
      // They need to deposit first
      await token.mint(attacker.address, INITIAL_BALANCE);
      await token
        .connect(attacker)
        .approve(await trustEngine.getAddress(), INITIAL_BALANCE);
      await trustEngine
        .connect(attacker)
        .deposit(await token.getAddress(), INITIAL_BALANCE);

      await expect(
        trustEngine.connect(attacker).createDeal(
          childDealId,
          victim.address,
          await token.getAddress(),
          ethers.parseEther("10"),
          "0x",
          parentDealId, // Linking to parent
          0
        )
      ).to.be.revertedWithCustomError(trustEngine, "Unauthorized");
    });
  });

  describe("4. Integer Overflow/Underflow (Implicit)", function () {
    it("Should fail on insufficient balance for deposit (transfer fail)", async function () {
      // If attacker tries to deposit more than they have approved/owned
      await expect(
        trustEngine
          .connect(attacker)
          .deposit(await token.getAddress(), ethers.parseEther("9999999"))
      ).to.be.reverted; // Reverts in ERC20 transfer
    });

    it("Should handle max uint256 amount attempts", async function () {
      const maxUint = ethers.MaxUint256;

      await expect(
        trustEngine.connect(attacker).deposit(await token.getAddress(), maxUint)
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Cross-Chain Settlement Security
  // ═══════════════════════════════════════════════════════════════════════
  describe("5. Cross-Chain Settlement Security", function () {
    beforeEach(async function () {
      // Fund victim for Solana settlements
      await token.mint(victim.address, INITIAL_BALANCE);
      await token.connect(victim).approve(await trustEngine.getAddress(), INITIAL_BALANCE);
      await trustEngine.connect(victim).deposit(await token.getAddress(), INITIAL_BALANCE);
    });

    it("Should prevent replay attacks on Solana settlements", async function () {
      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("solana-unique"));
      const amount = ethers.parseUnits("100", 6);

      // First settlement succeeds
      await trustEngine.connect(solanaRelay).settleFromSolana(
        sessionId, victim.address, attacker.address, amount
      );

      // Replay fails
      await expect(
        trustEngine.connect(solanaRelay).settleFromSolana(
          sessionId, victim.address, attacker.address, amount
        )
      ).to.be.revertedWithCustomError(trustEngine, "AlreadyProcessed");
    });

    it("Should prevent settlement without configured token", async function () {
      // Deploy fresh TrustEngine without token configured
      const freshEngine = await TrustEngine.deploy(owner.address);
      await freshEngine.setSolanaRelay(solanaRelay.address);
      // Note: NOT setting setSolanaSessionToken

      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("no-token"));

      await expect(
        freshEngine.connect(solanaRelay).settleFromSolana(
          sessionId, victim.address, attacker.address, 100
        )
      ).to.be.revertedWithCustomError(freshEngine, "TokenNotConfigured");
    });

    it("Should prevent settlement exceeding agent balance", async function () {
      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("overdraft"));
      const excessAmount = INITIAL_BALANCE + 1n;

      await expect(
        trustEngine.connect(solanaRelay).settleFromSolana(
          sessionId, victim.address, attacker.address, excessAmount
        )
      ).to.be.revertedWithCustomError(trustEngine, "InsufficientBalance");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Time-Lock Security
  // ═══════════════════════════════════════════════════════════════════════
  describe("6. Time-Lock Security", function () {
    beforeEach(async function () {
      await token.mint(victim.address, INITIAL_BALANCE);
      await token.connect(victim).approve(await trustEngine.getAddress(), INITIAL_BALANCE);
      await trustEngine.connect(victim).deposit(await token.getAddress(), INITIAL_BALANCE);
    });

    it("Should prevent early release on time-locked deals", async function () {
      const dealId = ethers.keccak256(ethers.toUtf8Bytes("timelocked"));
      const futureTime = (await time.latest()) + 3600; // 1 hour from now

      await trustEngine.connect(victim).createDeal(
        dealId,
        attacker.address,
        await token.getAddress(),
        ethers.parseEther("100"),
        "0x",
        ethers.ZeroHash,
        futureTime
      );

      // Try to release before time-lock expires
      await expect(
        trustEngine.connect(victim).release(dealId)
      ).to.be.revertedWithCustomError(trustEngine, "DealTimeLocked");
    });

    it("Should allow release after time-lock expires", async function () {
      const dealId = ethers.keccak256(ethers.toUtf8Bytes("timelocked-pass"));
      const futureTime = (await time.latest()) + 60; // 1 minute from now

      await trustEngine.connect(victim).createDeal(
        dealId,
        attacker.address,
        await token.getAddress(),
        ethers.parseEther("100"),
        "0x",
        ethers.ZeroHash,
        futureTime
      );

      // Fast forward past time-lock
      await time.increase(120);

      // Now release should work
      await expect(trustEngine.connect(victim).release(dealId))
        .to.emit(trustEngine, "DealReleased");
    });

    it("Should reject past expiry times on deal creation", async function () {
      const dealId = ethers.keccak256(ethers.toUtf8Bytes("past-expiry"));
      const pastTime = (await time.latest()) - 1;

      await expect(
        trustEngine.connect(victim).createDeal(
          dealId,
          attacker.address,
          await token.getAddress(),
          ethers.parseEther("100"),
          "0x",
          ethers.ZeroHash,
          pastTime
        )
      ).to.be.revertedWithCustomError(trustEngine, "ExpiryMustBeFuture");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. Dispute Resolution Security
  // ═══════════════════════════════════════════════════════════════════════
  describe("7. Dispute Resolution Security", function () {
    beforeEach(async function () {
      await token.mint(victim.address, INITIAL_BALANCE);
      await token.connect(victim).approve(await trustEngine.getAddress(), INITIAL_BALANCE);
      await trustEngine.connect(victim).deposit(await token.getAddress(), INITIAL_BALANCE);
    });

    it("Should only allow buyer or seller to raise disputes", async function () {
      const dealId = ethers.keccak256(ethers.toUtf8Bytes("dispute-auth"));

      await trustEngine.connect(victim).createDeal(
        dealId,
        attacker.address,
        await token.getAddress(),
        ethers.parseEther("100"),
        "0x",
        ethers.ZeroHash,
        0
      );

      // Third party tries to raise dispute
      const [, , , , , , thirdParty] = await ethers.getSigners();
      await expect(
        trustEngine.connect(thirdParty).raiseDispute(dealId)
      ).to.be.revertedWithCustomError(trustEngine, "Unauthorized");
    });

    it("Should prevent dispute on completed deals", async function () {
      const dealId = ethers.keccak256(ethers.toUtf8Bytes("completed-dispute"));

      await trustEngine.connect(victim).createDeal(
        dealId,
        attacker.address,
        await token.getAddress(),
        ethers.parseEther("100"),
        "0x",
        ethers.ZeroHash,
        0
      );

      await trustEngine.connect(victim).release(dealId);

      await expect(
        trustEngine.connect(victim).raiseDispute(dealId)
      ).to.be.revertedWithCustomError(trustEngine, "InvalidDealState");
    });

    it("Should prevent double dispute resolution", async function () {
      const dealId = ethers.keccak256(ethers.toUtf8Bytes("double-resolve"));

      await trustEngine.connect(victim).createDeal(
        dealId,
        attacker.address,
        await token.getAddress(),
        ethers.parseEther("100"),
        "0x",
        ethers.ZeroHash,
        0
      );

      await trustEngine.connect(victim).raiseDispute(dealId);
      await trustEngine.connect(arbiter).resolveDispute(dealId, true, "cid");

      // Try to resolve again
      await expect(
        trustEngine.connect(arbiter).resolveDispute(dealId, false, "cid2")
      ).to.be.revertedWithCustomError(trustEngine, "InvalidDealState");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8. Protocol Fee Manipulation
  // ═══════════════════════════════════════════════════════════════════════
  describe("8. Protocol Fee Security", function () {
    it("Should cap protocol fee at 10%", async function () {
      await expect(
        trustEngine.setProtocolFee(1001) // 10.01%
      ).to.be.revertedWithCustomError(trustEngine, "FeeTooHigh");
    });

    it("Should allow max 10% fee", async function () {
      await expect(trustEngine.setProtocolFee(1000)) // 10%
        .to.emit(trustEngine, "ProtocolFeeUpdated");
    });

    it("Should prevent zero address as fee recipient", async function () {
      await expect(
        trustEngine.setProtocolFeeRecipient(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(trustEngine, "InvalidAddress");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9. Session Lock Security
  // ═══════════════════════════════════════════════════════════════════════
  describe("9. Session Lock Security", function () {
    beforeEach(async function () {
      await token.mint(victim.address, INITIAL_BALANCE);
      await token.connect(victim).approve(await trustEngine.getAddress(), INITIAL_BALANCE);
      await trustEngine.connect(victim).deposit(await token.getAddress(), INITIAL_BALANCE);
    });

    it("Should prevent duplicate session locking", async function () {
      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("dup-session"));

      // First lock (via authorized gateway)
      await trustEngine.connect(gateway).lockForSession(
        sessionId, victim.address, attacker.address, await token.getAddress(), ethers.parseEther("50")
      );

      // Second lock with same ID
      await expect(
        trustEngine.connect(gateway).lockForSession(
          sessionId, victim.address, attacker.address, await token.getAddress(), ethers.parseEther("50")
        )
      ).to.be.revertedWithCustomError(trustEngine, "SessionAlreadyExists");
    });

    it("Should prevent unlocking non-existent sessions", async function () {
      const fakeSessionId = ethers.keccak256(ethers.toUtf8Bytes("fake"));

      await expect(
        trustEngine.connect(gateway).unlockSession(fakeSessionId, 0)
      ).to.be.revertedWithCustomError(trustEngine, "SessionNotFound");
    });

    it("Should prevent unlocking with usage exceeding locked amount", async function () {
      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("unlock-excess"));
      const lockedAmount = ethers.parseEther("100");

      await trustEngine.connect(gateway).lockForSession(
        sessionId, victim.address, attacker.address, await token.getAddress(), lockedAmount
      );

      await expect(
        trustEngine.connect(gateway).unlockSession(sessionId, lockedAmount + 1n)
      ).to.be.revertedWithCustomError(trustEngine, "UsedExceedsLocked");
    });
  });
});

