// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title IdentityRegistry
 * @dev ERC-8004 compliant Identity Registry for AI Agents
 *
 * Each agent receives a unique AgentID (ERC-721 NFT) that maps to:
 * - Their Ethereum address
 * - An off-chain "Agent Card" containing metadata about capabilities
 *
 * One agent per address enforced.
 */
contract IdentityRegistry is ERC721, ERC721URIStorage, Ownable {
    // Counter for unique agent IDs
    uint256 private _nextAgentId;

    // Mapping: address => agentId (0 means not registered)
    mapping(address => uint256) public addressToAgentId;

    // Mapping: agentId => registration data
    struct AgentRegistration {
        string registrationUri; // Points to off-chain Agent Card JSON
        bytes32 registrationHash; // Commitment hash for data integrity
        uint256 registeredAt;
        uint256 lastUpdated;
    }

    mapping(uint256 => AgentRegistration) public registrations;

    // Events per ERC-8004 spec
    event AgentRegistered(
        uint256 indexed agentId,
        address indexed owner,
        string registrationUri,
        bytes32 registrationHash
    );

    event AgentUpdated(
        uint256 indexed agentId,
        string registrationUri,
        bytes32 registrationHash
    );

    constructor(
        address _initialOwner
    ) ERC721("Cart.fun Agent", "AGENT") Ownable(_initialOwner) {
        _nextAgentId = 1; // Start from 1 (0 reserved for "not registered")
    }

    /**
     * @dev Register a new agent. Mints an NFT to the caller.
     * @param registrationUri URI pointing to off-chain Agent Card JSON
     * @param registrationHash Hash commitment of the registration data (optional if using IPFS)
     * @return agentId The newly minted agent ID
     */
    function register(
        string calldata registrationUri,
        bytes32 registrationHash
    ) external returns (uint256 agentId) {
        require(bytes(registrationUri).length > 0, "Registration URI required");
        require(addressToAgentId[msg.sender] == 0, "Already registered");

        agentId = _nextAgentId++;

        _safeMint(msg.sender, agentId);
        _setTokenURI(agentId, registrationUri);

        addressToAgentId[msg.sender] = agentId;

        registrations[agentId] = AgentRegistration({
            registrationUri: registrationUri,
            registrationHash: registrationHash,
            registeredAt: block.timestamp,
            lastUpdated: block.timestamp
        });

        emit AgentRegistered(
            agentId,
            msg.sender,
            registrationUri,
            registrationHash
        );
    }

    /**
     * @dev Update an existing agent's registration data.
     * @param agentId The agent ID to update
     * @param registrationUri New URI pointing to updated Agent Card
     * @param registrationHash New hash commitment
     */
    function update(
        uint256 agentId,
        string calldata registrationUri,
        bytes32 registrationHash
    ) external {
        require(ownerOf(agentId) == msg.sender, "Not agent owner");
        require(bytes(registrationUri).length > 0, "Registration URI required");

        _setTokenURI(agentId, registrationUri);

        registrations[agentId].registrationUri = registrationUri;
        registrations[agentId].registrationHash = registrationHash;
        registrations[agentId].lastUpdated = block.timestamp;

        emit AgentUpdated(agentId, registrationUri, registrationHash);
    }

    /**
     * @dev Get agent details by ID
     * @param agentId The agent ID to query
     * @return owner The agent's owner address
     * @return registrationUri The agent's registration URI
     * @return registrationHash The registration hash commitment
     */
    function getAgent(
        uint256 agentId
    )
        external
        view
        returns (
            address owner,
            string memory registrationUri,
            bytes32 registrationHash
        )
    {
        owner = ownerOf(agentId);
        AgentRegistration storage reg = registrations[agentId];
        registrationUri = reg.registrationUri;
        registrationHash = reg.registrationHash;
    }

    /**
     * @dev Get agent ID by owner address
     * @param owner The address to query
     * @return agentId The agent ID (0 if not registered)
     */
    function getAgentByOwner(
        address owner
    ) external view returns (uint256 agentId) {
        return addressToAgentId[owner];
    }

    /**
     * @dev Check if an address is registered as an agent
     * @param addr The address to check
     * @return True if registered
     */
    function isRegistered(address addr) external view returns (bool) {
        return addressToAgentId[addr] != 0;
    }

    /**
     * @dev Get total number of registered agents
     * @return The count of registered agents
     */
    function totalAgents() external view returns (uint256) {
        return _nextAgentId - 1;
    }

    // Required overrides for ERC721URIStorage
    function tokenURI(
        uint256 tokenId
    ) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
