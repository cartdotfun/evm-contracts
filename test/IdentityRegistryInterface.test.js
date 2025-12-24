
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("IdentityRegistry Interface Completeness", function () {
    let identityRegistry;
    let owner;

    beforeEach(async function () {
        [owner] = await ethers.getSigners();

        // Deploy IdentityRegistry
        const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
        const identityRegistryContract = await IdentityRegistry.deploy(owner.address);
        await identityRegistryContract.waitForDeployment();
        
        // Get contract instance at the interface level
        identityRegistry = await ethers.getContractAt("IIdentityRegistry", await identityRegistryContract.getAddress());
    });

    it("should fail to get addressToAgentId due to missing getter in interface", async function () {
        // This test is expected to fail because 'addressToAgentId(address)' is not in the IIdentityRegistry interface
        await expect(identityRegistry.addressToAgentId(owner.address)).to.be.revertedWith("identityRegistry.addressToAgentId is not a function");
    });
});
