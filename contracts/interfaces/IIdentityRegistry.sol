// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IIdentityRegistry
 * @dev ERC-8004 Identity Registry Interface
 *
 * Provides a standardized interface for registering and managing AI agent identities.
 * Each agent receives a unique AgentID (ERC-721 NFT) that maps to their identity.
 */
interface IIdentityRegistry {
    // ═══════════════════════════════════════════════════════════════════════
    // Structs
    // ═══════════════════════════════════════════════════════════════════════

    struct MetadataEntry {
        string key;
        bytes value;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Events
    // ═══════════════════════════════════════════════════════════════════════

    event Registered(
        uint256 indexed agentId,
        string tokenURI,
        address indexed owner
    );

    event MetadataSet(
        uint256 indexed agentId,
        string indexed indexedKey,
        string key,
        bytes value
    );

    // ═══════════════════════════════════════════════════════════════════════
    // Registration Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Register with tokenURI and metadata entries
     * @param tokenURI URI pointing to off-chain registration JSON
     * @param metadata Array of key-value metadata entries
     * @return agentId The newly minted agent ID
     */
    function register(
        string calldata tokenURI,
        MetadataEntry[] calldata metadata
    ) external returns (uint256 agentId);

    /**
     * @dev Register with tokenURI only
     * @param tokenURI URI pointing to off-chain registration JSON
     * @return agentId The newly minted agent ID
     */
    function register(
        string calldata tokenURI
    ) external returns (uint256 agentId);

    /**
     * @dev Register without URI (minimal registration)
     * @return agentId The newly minted agent ID
     */
    function register() external returns (uint256 agentId);

    // ═══════════════════════════════════════════════════════════════════════
    // Metadata Functions
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
    ) external view returns (bytes memory value);

    /**
     * @dev Set on-chain metadata for an agent
     * @param agentId The agent ID
     * @param key The metadata key
     * @param value The metadata value to set
     */
    function setMetadata(
        uint256 agentId,
        string calldata key,
        bytes calldata value
    ) external;

    // ═══════════════════════════════════════════════════════════════════════
    // Read Functions
    // Note: For ownerOf(tokenId), callers should cast to IERC721 since
    // IdentityRegistry inherits from ERC721.
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Check if an address is registered as an agent
     * @param addr The address to check
     * @return True if registered
     */
    function isRegistered(address addr) external view returns (bool);

    /**
     * @dev Get agent ID by owner address
     * @param owner The address to query
     * @return agentId The agent ID (0 if not registered)
     */
    function getAgentByOwner(
        address owner
    ) external view returns (uint256 agentId);

    /**
     * @dev Get total number of registered agents
     * @return The count of registered agents
     */
    function totalAgents() external view returns (uint256);
}
