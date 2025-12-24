
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("IdentityRegistry", function () {
    let identityRegistry;
    let owner;
    let agent1;
    let agent2;

    beforeEach(async function () {
        [owner, agent1, agent2] = await ethers.getSigners();

        const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
        identityRegistry = await IdentityRegistry.deploy(owner.address);
        await identityRegistry.waitForDeployment();
    });

    describe("Registration", function () {
        it("should register an agent with URI and hash", async function () {
            const uri = "ipfs://QmTest";
            const hash = ethers.keccak256(ethers.toUtf8Bytes("test"));
            
            await expect(identityRegistry.connect(agent1)["register(string,bytes32)"](uri, hash))
                .to.emit(identityRegistry, "AgentRegistered")
                .withArgs(1, agent1.address, uri, hash);

            expect(await identityRegistry.addressToAgentId(agent1.address)).to.equal(1);
            expect(await identityRegistry.isRegistered(agent1.address)).to.be.true;
            expect(await identityRegistry.totalAgents()).to.equal(1);

            const agent = await identityRegistry.getAgent(1);
            expect(agent.owner).to.equal(agent1.address);
            expect(agent.registrationUri).to.equal(uri);
            expect(agent.registrationHash).to.equal(hash);
        });

        it("should reject duplicate registration", async function () {
            await identityRegistry.connect(agent1)["register(string,bytes32)"]("uri", ethers.ZeroHash);
            await expect(identityRegistry.connect(agent1)["register(string,bytes32)"]("uri2", ethers.ZeroHash))
                .to.be.revertedWith("Already registered");
        });

        it("should reject registration with empty URI", async function () {
            await expect(identityRegistry.connect(agent1)["register(string,bytes32)"]("", ethers.ZeroHash))
                .to.be.revertedWith("Registration URI required");
        });

        it("should register using ERC-8004 overloads", async function () {
            // register(string, MetadataEntry[])
            const metadata = [{ key: "name", value: ethers.toUtf8Bytes("Agent 2") }];
            await expect(identityRegistry.connect(agent2)["register(string,(string,bytes)[])"]("uri2", metadata))
                .to.emit(identityRegistry, "Registered")
                .withArgs(1, "uri2", agent2.address);

            expect(await identityRegistry.getMetadata(1, "name")).to.equal(ethers.hexlify(ethers.toUtf8Bytes("Agent 2")));

            // register(string)
            await expect(identityRegistry.connect(owner)["register(string)"]("uri3"))
                .to.emit(identityRegistry, "Registered");

            // register()
            const agent3 = (await ethers.getSigners())[3];
            await expect(identityRegistry.connect(agent3)["register()"]())
                .to.emit(identityRegistry, "Registered");
        });
    });

    describe("Updates", function () {
        it("should update agent registration", async function () {
            await identityRegistry.connect(agent1)["register(string,bytes32)"]("uri1", ethers.ZeroHash);
            const newUri = "uri2";
            const newHash = ethers.keccak256(ethers.toUtf8Bytes("new"));

            await expect(identityRegistry.connect(agent1).update(1, newUri, newHash))
                .to.emit(identityRegistry, "AgentUpdated")
                .withArgs(1, newUri, newHash);

            const agent = await identityRegistry.getAgent(1);
            expect(agent.registrationUri).to.equal(newUri);
            expect(agent.registrationHash).to.equal(newHash);
        });

        it("should only allow owner to update", async function () {
            await identityRegistry.connect(agent1)["register(string,bytes32)"]("uri1", ethers.ZeroHash);
            await expect(identityRegistry.connect(agent2).update(1, "uri2", ethers.ZeroHash))
                .to.be.revertedWith("Not agent owner");
        });
    });

    describe("Metadata", function () {
        it("should set and get metadata", async function () {
            await identityRegistry.connect(agent1)["register()"]();
            const key = "skill";
            const value = ethers.toUtf8Bytes("coding");

            await expect(identityRegistry.connect(agent1).setMetadata(1, key, value))
                .to.emit(identityRegistry, "MetadataSet");

            expect(await identityRegistry.getMetadata(1, key)).to.equal(ethers.hexlify(value));
        });

        it("should only allow owner or authorized to set metadata", async function () {
            await identityRegistry.connect(agent1)["register()"]();
            await expect(identityRegistry.connect(agent2).setMetadata(1, "key", "0x1234"))
                .to.be.revertedWith("Not authorized");
        });
    });

    describe("ERC721 Overrides", function () {
        it("should return tokenURI", async function () {
            await identityRegistry.connect(agent1)["register(string,bytes32)"]("ipfs://test", ethers.ZeroHash);
            expect(await identityRegistry.tokenURI(1)).to.equal("ipfs://test");
        });

        it("should support interfaces", async function () {
            // ERC721 interface ID
            expect(await identityRegistry.supportsInterface("0x80ac58cd")).to.be.true;
        });
    });
});
