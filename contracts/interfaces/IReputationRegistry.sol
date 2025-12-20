// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IReputationRegistry
 * @dev ERC-8004 Reputation Registry Interface
 *
 * Provides a standardized interface for posting and fetching feedback signals
 * for AI agents. Supports signature-authorized feedback and aggregated reputation.
 */
interface IReputationRegistry {
    // ═══════════════════════════════════════════════════════════════════════
    // Events
    // ═══════════════════════════════════════════════════════════════════════

    event NewFeedback(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint8 score,
        bytes32 tag1,
        bytes32 tag2,
        string fileuri,
        bytes32 filehash
    );

    event FeedbackRevoked(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 indexed feedbackIndex
    );

    event ResponseAppended(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        address indexed responder,
        string responseUri
    );

    // ═══════════════════════════════════════════════════════════════════════
    // Core Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Give feedback with signature authorization (ERC-8004 compliant)
     * @param agentId The agent receiving feedback
     * @param score Score from 0-100
     * @param tag1 Primary categorization tag
     * @param tag2 Secondary categorization tag
     * @param fileuri URI pointing to detailed feedback
     * @param filehash Hash commitment of feedback data
     * @param feedbackAuth Encoded authorization (indexLimit, expiry, signer, signature)
     */
    function giveFeedback(
        uint256 agentId,
        uint8 score,
        bytes32 tag1,
        bytes32 tag2,
        string calldata fileuri,
        bytes32 filehash,
        bytes memory feedbackAuth
    ) external;

    /**
     * @dev Revoke previously given feedback
     * @param agentId The agent ID
     * @param feedbackIndex The feedback index to revoke
     */
    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external;

    /**
     * @dev Append a response to existing feedback
     * @param agentId The agent ID
     * @param clientAddress The original feedback giver
     * @param feedbackIndex The feedback index
     * @param responseUri URI pointing to response data
     * @param responseHash Hash commitment of response
     */
    function appendResponse(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        string calldata responseUri,
        bytes32 responseHash
    ) external;

    // ═══════════════════════════════════════════════════════════════════════
    // Read Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Get the identity registry address
     */
    function getIdentityRegistry() external view returns (address);

    /**
     * @dev Read a single feedback entry
     * @param agentId The agent ID
     * @param clientAddress The feedback giver
     * @param index The feedback index
     */
    function readFeedback(
        uint256 agentId,
        address clientAddress,
        uint64 index
    )
        external
        view
        returns (uint8 score, bytes32 tag1, bytes32 tag2, bool isRevoked);

    /**
     * @dev Read all feedback with optional filtering
     * @param agentId The agent ID
     * @param clientAddresses Filter by clients (empty = all)
     * @param tag1 Filter by tag1 (bytes32(0) = all)
     * @param tag2 Filter by tag2 (bytes32(0) = all)
     * @param includeRevoked Whether to include revoked feedback
     */
    function readAllFeedback(
        uint256 agentId,
        address[] calldata clientAddresses,
        bytes32 tag1,
        bytes32 tag2,
        bool includeRevoked
    )
        external
        view
        returns (
            address[] memory clients,
            uint8[] memory scores,
            bytes32[] memory tag1s,
            bytes32[] memory tag2s,
            bool[] memory revokedStatuses
        );

    /**
     * @dev Get all clients who have given feedback to an agent
     * @param agentId The agent ID
     */
    function getClients(
        uint256 agentId
    ) external view returns (address[] memory);

    /**
     * @dev Get the last feedback index for a client-agent pair
     * @param agentId The agent ID
     * @param clientAddress The client address
     */
    function getLastIndex(
        uint256 agentId,
        address clientAddress
    ) external view returns (uint64);

    /**
     * @dev Get response count for a feedback
     * @param agentId The agent ID
     * @param clientAddress The feedback giver
     * @param feedbackIndex The feedback index
     * @param responders Filter by responders (empty = all)
     */
    function getResponseCount(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        address[] calldata responders
    ) external view returns (uint64);
}
