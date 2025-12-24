// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IIdentityRegistry.sol";

/**
 * @title IdentityRegistry
 * @dev ERC-8004 compliant Identity Registry for AI Agents
 *
 * Each agent receives a unique AgentID (ERC-721 NFT) that maps to:
 * - Their Ethereum address
 * - An off-chain registration file containing metadata about capabilities
 *
 * Supports on-chain metadata via getMetadata/setMetadata per ERC-8004 spec.
 */
contract IdentityRegistry is
    ERC721,
    ERC721URIStorage,
    Ownable,
    IIdentityRegistry
{
    // ═══════════════════════════════════════════════════════════════════════
    // State Variables
    // ═══════════════════════════════════════════════════════════════════════

    // Counter for unique agent IDs
    uint256 private _nextAgentId;

    // Mapping: address => agentId (0 means not registered)
    mapping(address => uint256) public addressToAgentId;

    mapping(uint256 => AgentRegistration) public registrations;

    // ERC-8004: On-chain metadata storage (agentId => key => value)
    mapping(uint256 => mapping(string => bytes)) private _metadata;

    constructor(
        address _initialOwner
    ) ERC721("Cart.fun Agent", "CART") Ownable(_initialOwner) {
        _nextAgentId = 1; // Start from 1 (0 reserved for "not registered")
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Core Functions
    // ═══════════════════════════════════════════════════════════════════════

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
        
        agentId = _registerAgent(msg.sender, registrationUri, registrationHash);

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

    // ═══════════════════════════════════════════════════════════════════════
    // ERC-8004 Registration Overloads
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Register with tokenURI and metadata entries (ERC-8004 compliant)
     * @param _tokenURI URI pointing to off-chain registration JSON
     * @param metadata Array of key-value metadata entries
     * @return agentId The newly minted agent ID
     */
    function register(
        string calldata _tokenURI,
        MetadataEntry[] calldata metadata
    ) external returns (uint256 agentId) {
        agentId = _registerAgent(msg.sender, _tokenURI, bytes32(0));

        // Set each metadata entry
        for (uint256 i = 0; i < metadata.length; i++) {
            _metadata[agentId][metadata[i].key] = metadata[i].value;
            emit MetadataSet(
                agentId,
                metadata[i].key,
                metadata[i].key,
                metadata[i].value
            );
        }

        emit Registered(agentId, _tokenURI, msg.sender);
    }

    /**
     * @dev Register with tokenURI only (ERC-8004 compliant)
     * @param _tokenURI URI pointing to off-chain registration JSON
     * @return agentId The newly minted agent ID
     */
    function register(
        string calldata _tokenURI
    ) external returns (uint256 agentId) {
        agentId = _registerAgent(msg.sender, _tokenURI, bytes32(0));
        emit Registered(agentId, _tokenURI, msg.sender);
    }

    /**
     * @dev Register without URI (can be added later with _setTokenURI)
     * @return agentId The newly minted agent ID
     */
    function register() external returns (uint256 agentId) {
        agentId = _registerAgent(msg.sender, "", bytes32(0));
        emit Registered(agentId, "", msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ERC-8004 Metadata Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Get on-chain metadata for an agent
     * @param agentId The agent ID
     * @param key The metadata key
     * @return value The metadata value
     */
    function getMetadata(
        uint256 agentId,
        string calldata key
    ) external view returns (bytes memory value) {
        return _metadata[agentId][key];
    }

    /**
     * @dev Set on-chain metadata for an agent (owner or operator only)
     * @param agentId The agent ID
     * @param key The metadata key
     * @param value The metadata value to set
     */
    function setMetadata(
        uint256 agentId,
        string calldata key,
        bytes calldata value
    ) external {
        require(
            ownerOf(agentId) == msg.sender ||
                _isAuthorized(ownerOf(agentId), msg.sender, agentId),
            "Not authorized"
        );

        _metadata[agentId][key] = value;
        emit MetadataSet(agentId, key, key, value);
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

    // ═══════════════════════════════════════════════════════════════════════
    // Internal Helper Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Internal registration logic
     */
    function _registerAgent(
        address registrant,
        string memory uri,
        bytes32 hash
    ) private returns (uint256) {
        require(addressToAgentId[registrant] == 0, "Already registered");

        uint256 agentId = _nextAgentId++;
        _safeMint(registrant, agentId);

        if (bytes(uri).length > 0) {
            _setTokenURI(agentId, uri);
        }

        addressToAgentId[registrant] = agentId;

        registrations[agentId] = AgentRegistration({
            registrationUri: uri,
            registrationHash: hash,
            registeredAt: block.timestamp,
            lastUpdated: block.timestamp
        });

        return agentId;
    }
}
