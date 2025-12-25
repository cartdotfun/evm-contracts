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

    struct AgentRegistration {
        string registrationUri; // Points to off-chain registration JSON
        bytes32 registrationHash; // Commitment hash for data integrity
        uint256 registeredAt;
        uint256 lastUpdated;
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

    // ═══════════════════════════════════════════════════════════════════════
    // Registration Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Register a new agent with full verification support.
     * @dev Use case: When you have off-chain data (JSON Agent Card) AND want to verify integrity.
     *      The hash commitment allows verification that the off-chain data hasn't been tampered with.
     * @param registrationUri URI pointing to off-chain Agent Card JSON (IPFS, HTTPS, etc.)
     * @param registrationHash Hash commitment of the registration data for integrity verification
     * @return agentId The newly minted agent ID
     */
    function register(
        string calldata registrationUri,
        bytes32 registrationHash
    ) external returns (uint256 agentId);

    /**
     * @notice Register with tokenURI and on-chain metadata entries.
     * @dev Use case: When you want both off-chain data AND on-chain metadata stored.
     *      On-chain metadata is useful for indexing, capability flags, or frequently accessed attributes.
     * @param tokenURI URI pointing to off-chain registration JSON
     * @param metadata Array of key-value metadata entries to store on-chain
     * @return agentId The newly minted agent ID
     */
    function register(
        string calldata tokenURI,
        MetadataEntry[] calldata metadata
    ) external returns (uint256 agentId);

    /**
     * @notice Register with tokenURI only.
     * @dev Use case: Simple registration with just a pointer to off-chain data.
     *      Ideal when hash verification isn't needed (e.g., if you trust IPFS content addressing).
     * @param tokenURI URI pointing to off-chain registration JSON
     * @return agentId The newly minted agent ID
     */
    function register(
        string calldata tokenURI
    ) external returns (uint256 agentId);

    /**
     * @notice Minimal registration - just mint the agent NFT.
     * @dev Use case: Bare-bones registration when you want to get an agentId immediately
     *      and add metadata/URI later via setMetadata() or update().
     * @return agentId The newly minted agent ID
     */
    function register() external returns (uint256 agentId);

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
    ) external;

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
        );

    function addressToAgentId(address owner) external view returns (uint256);

    function registrations(
        uint256 agentId
    )
        external
        view
        returns (
            string memory registrationUri,
            bytes32 registrationHash,
            uint256 registeredAt,
            uint256 lastUpdated
        );
}
