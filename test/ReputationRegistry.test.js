
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ReputationRegistry", function () {
    let reputationRegistry;
    let identityRegistry;
    let owner;
    let agent1;
    let client1;
    let agent1Id;

    beforeEach(async function () {
        [owner, agent1, client1] = await ethers.getSigners();

        const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
        identityRegistry = await IdentityRegistry.deploy(owner.address);
        await identityRegistry.waitForDeployment();

        const ReputationRegistry = await ethers.getContractFactory("ReputationRegistry");
        reputationRegistry = await ReputationRegistry.deploy(await identityRegistry.getAddress(), owner.address);
        await reputationRegistry.waitForDeployment();

        // Register agent1
        await identityRegistry.connect(agent1)["register()"]();
        agent1Id = 1;
    });

    describe("Basic Feedback", function () {
        it("should post feedback", async function () {
            const score = 85;
            const skillTag = ethers.keccak256(ethers.toUtf8Bytes("coding"));
            const uri = "ipfs://feedback";
            const hash = ethers.keccak256(ethers.toUtf8Bytes("some-hash"));
            const dealId = ethers.keccak256(ethers.toUtf8Bytes("deal-123"));

            await expect(reputationRegistry.connect(client1).postFeedback(agent1Id, score, skillTag, uri, hash, dealId))
                .to.emit(reputationRegistry, "FeedbackPosted")
                .withArgs(agent1Id, client1.address, hash, score, skillTag, dealId);

            expect(await reputationRegistry.getFeedbackCount(agent1Id)).to.equal(1);
            
            const summary = await reputationRegistry.getSummary(agent1Id, skillTag);
            expect(summary.count).to.equal(1);
            expect(summary.avgScore).to.equal(score);

            const overall = await reputationRegistry.getSummary(agent1Id, ethers.ZeroHash);
            expect(overall.count).to.equal(1);
            expect(overall.avgScore).to.equal(score);
        });

        it("should get feedback details", async function () {
            const hash = ethers.keccak256(ethers.toUtf8Bytes("hash2"));
            await reputationRegistry.connect(client1).postFeedback(agent1Id, 90, ethers.ZeroHash, "", hash, ethers.ZeroHash);
            const hashes = await reputationRegistry.getFeedbackHashes(agent1Id);
            expect(hashes).to.include(hash);

            const feedback = await reputationRegistry.getFeedback(hash);
            expect(feedback.reviewer).to.equal(client1.address);
            expect(feedback.score).to.equal(90);
        });
    });

    describe("ERC-8004 Feedback", function () {
        it("should give feedback with valid signature", async function () {
            const score = 95;
            const tag1 = ethers.keccak256(ethers.toUtf8Bytes("tag1"));
            const tag2 = ethers.keccak256(ethers.toUtf8Bytes("tag2"));
            const indexLimit = 10;
            const expiry = Math.floor(Date.now() / 1000) + 3600;
            const identityRegistryAddr = await identityRegistry.getAddress();
            const chainId = (await ethers.provider.getNetwork()).chainId;

            // Reconstruct structHash per contract logic:
            // keccak256(abi.encodePacked(agentId, msg.sender, indexLimit, expiry, chainId, identityRegistry, signer))
            const structHash = ethers.solidityPackedKeccak256(
                ["uint256", "address", "uint64", "uint64", "uint256", "address", "address"],
                [agent1Id, client1.address, indexLimit, expiry, chainId, identityRegistryAddr, agent1.address]
            );

            // Sign the hash using Ethereum Signed Message format
            const signature = await agent1.signMessage(ethers.getBytes(structHash));

            // Encoded authorization: (indexLimit, expiry, signerAddress, signature)
            const feedbackAuth = ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint64", "uint64", "address", "bytes"],
                [indexLimit, expiry, agent1.address, signature]
            );

            await expect(reputationRegistry.connect(client1).giveFeedback(agent1Id, score, tag1, tag2, "uri", ethers.ZeroHash, feedbackAuth))
                .to.emit(reputationRegistry, "NewFeedback")
                .withArgs(agent1Id, client1.address, score, tag1, tag2, "uri", ethers.ZeroHash);

            expect(await reputationRegistry.getLastIndex(agent1Id, client1.address)).to.equal(1);
            
            const fb = await reputationRegistry.readFeedback(agent1Id, client1.address, 1);
            expect(fb.score).to.equal(score);
            expect(fb.isRevoked).to.be.false;
        });

        it("should revoke feedback", async function () {
            // Setup feedback
            const indexLimit = 10;
            const expiry = Math.floor(Date.now() / 1000) + 3600;
            const identityRegistryAddr = await identityRegistry.getAddress();
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const structHash = ethers.solidityPackedKeccak256(
                ["uint256", "address", "uint64", "uint64", "uint256", "address", "address"],
                [agent1Id, client1.address, indexLimit, expiry, chainId, identityRegistryAddr, agent1.address]
            );
            const signature = await agent1.signMessage(ethers.getBytes(structHash));
            const feedbackAuth = ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint64", "uint64", "address", "bytes"],
                [indexLimit, expiry, agent1.address, signature]
            );
            await reputationRegistry.connect(client1).giveFeedback(agent1Id, 80, ethers.ZeroHash, ethers.ZeroHash, "", ethers.ZeroHash, feedbackAuth);

            await expect(reputationRegistry.connect(client1).revokeFeedback(agent1Id, 1))
                .to.emit(reputationRegistry, "FeedbackRevoked")
                .withArgs(agent1Id, client1.address, 1);

            const fb = await reputationRegistry.readFeedback(agent1Id, client1.address, 1);
            expect(fb.isRevoked).to.be.true;
        });

        it("should append response", async function () {
            // Setup feedback
            const indexLimit = 10;
            const expiry = Math.floor(Date.now() / 1000) + 3600;
            const identityRegistryAddr = await identityRegistry.getAddress();
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const structHash = ethers.solidityPackedKeccak256(
                ["uint256", "address", "uint64", "uint64", "uint256", "address", "address"],
                [agent1Id, client1.address, indexLimit, expiry, chainId, identityRegistryAddr, agent1.address]
            );
            const signature = await agent1.signMessage(ethers.getBytes(structHash));
            const feedbackAuth = ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint64", "uint64", "address", "bytes"],
                [indexLimit, expiry, agent1.address, signature]
            );
            await reputationRegistry.connect(client1).giveFeedback(agent1Id, 80, ethers.ZeroHash, ethers.ZeroHash, "", ethers.ZeroHash, feedbackAuth);

            await expect(reputationRegistry.connect(agent1).appendResponse(agent1Id, client1.address, 1, "resp_uri", ethers.ZeroHash))
                .to.emit(reputationRegistry, "ResponseAppended")
                .withArgs(agent1Id, client1.address, 1, agent1.address, "resp_uri");

            expect(await reputationRegistry.getResponseCount(agent1Id, client1.address, 1, [])).to.equal(1);
        });

        it("should read all feedback with filtering", async function () {
            const indexLimit = 10;
            const expiry = Math.floor(Date.now() / 1000) + 3600;
            const identityRegistryAddr = await identityRegistry.getAddress();
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const structHash = ethers.solidityPackedKeccak256(
                ["uint256", "address", "uint64", "uint64", "uint256", "address", "address"],
                [agent1Id, client1.address, indexLimit, expiry, chainId, identityRegistryAddr, agent1.address]
            );
            const signature = await agent1.signMessage(ethers.getBytes(structHash));
            const feedbackAuth = ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint64", "uint64", "address", "bytes"],
                [indexLimit, expiry, agent1.address, signature]
            );

            const tagA = ethers.keccak256(ethers.toUtf8Bytes("A"));
            const tagB = ethers.keccak256(ethers.toUtf8Bytes("B"));

            await reputationRegistry.connect(client1).giveFeedback(agent1Id, 100, tagA, ethers.ZeroHash, "", ethers.ZeroHash, feedbackAuth);
            await reputationRegistry.connect(client1).giveFeedback(agent1Id, 50, tagB, ethers.ZeroHash, "", ethers.ZeroHash, feedbackAuth);

            const all = await reputationRegistry.readAllFeedback(agent1Id, [], ethers.ZeroHash, ethers.ZeroHash, true);
            expect(all.clients.length).to.equal(2);
            expect(all.scores[0]).to.equal(100);
            expect(all.scores[1]).to.equal(50);

            const filtered = await reputationRegistry.readAllFeedback(agent1Id, [], tagA, ethers.ZeroHash, true);
            expect(filtered.clients.length).to.equal(1);
            expect(filtered.scores[0]).to.equal(100);
            
            expect(await reputationRegistry.getClients(agent1Id)).to.deep.equal([client1.address]);
        });
    });

    describe("Admin", function () {
        it("should set identity registry", async function () {
            const newAddr = ethers.Wallet.createRandom().address;
            await reputationRegistry.connect(owner).setIdentityRegistry(newAddr);
            expect(await reputationRegistry.identityRegistry()).to.equal(newAddr);
        });

        it("should only allow owner to set identity registry", async function () {
            await expect(reputationRegistry.connect(agent1).setIdentityRegistry(agent1.address))
                .to.be.revertedWithCustomError(reputationRegistry, "OwnableUnauthorizedAccount");
        });
    });
});
