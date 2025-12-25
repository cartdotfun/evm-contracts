// SPDX-License-Identifier: MIT
// @author: Lloyd Faulk
// @author: Opus 4.5
// @version: 1.0.0

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
    // Structs
    // ═══════════════════════════════════════════════════════════════════════

    struct Feedback {
        address reviewer; // Who posted the feedback
        uint256 reviewerAgentId; // Reviewer's agent ID (0 if not an agent)
        uint8 score; // 0-100 score
        bytes32 skillTag; // e.g., keccak256("code_review")
        string feedbackUri; // Points to detailed feedback JSON
        bytes32 feedbackCommitment; // Commitment hash
        uint256 timestamp;
        bytes32 dealId; // Associated deal (optional, 0x0 if none)
    }

    struct ReputationSummary {
        uint64 count;
        uint64 totalScore; // Sum of all scores (for avg calculation)
        uint256 lastFeedbackAt;
    }

    struct Response {
        address responder;
        string uri;
        bytes32 hash;
    }

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

    event FeedbackPosted(
        uint256 indexed agentId,
        address indexed reviewer,
        bytes32 indexed feedbackHash,
        uint8 score,
        bytes32 skillTag,
        bytes32 dealId
    );

    // ═══════════════════════════════════════════════════════════════════════
    // Core Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Post feedback for an agent
     * @param agentId The agent receiving feedback
     * @param score Score from 0-100 (0 = failed, 100 = perfect)
     * @param skillTag Skill category (e.g., keccak256("arbitration"))
     * @param feedbackUri URI pointing to detailed feedback JSON
     * @param feedbackHash Hash commitment of feedback data
     * @param dealId Associated deal ID (optional)
     */
    function postFeedback(
        uint256 agentId,
        uint8 score,
        bytes32 skillTag,
        string calldata feedbackUri,
        bytes32 feedbackHash,
        bytes32 dealId
    ) external;

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

    /**
     * @dev Get aggregated reputation summary
     * @param agentId The agent to query
     * @param skillTag Skill filter (bytes32(0) for overall)
     * @return count Number of feedbacks
     * @return avgScore Average score (0-100)
     */
    function getSummary(
        uint256 agentId,
        bytes32 skillTag
    ) external view returns (uint64 count, uint8 avgScore);

    /**
     * @dev Get all feedback hashes for an agent
     * @param agentId The agent to query
     * @return Array of feedback hashes
     */
    function getFeedbackHashes(
        uint256 agentId
    ) external view returns (bytes32[] memory);

    /**
     * @dev Get feedback details by hash
     * @param feedbackHash The feedback hash to query
     * @return feedback The feedback record
     */
    function getFeedback(
        bytes32 feedbackHash
    ) external view returns (Feedback memory);

    /**
     * @dev Get feedback count for an agent
     * @param agentId The agent to query
     * @return count Number of feedbacks
     */
    function getFeedbackCount(uint256 agentId) external view returns (uint256);

    function identityRegistry() external view returns (address);

    function agentFeedbackHashes(uint256 agentId, uint256 index) external view returns (bytes32);

    function feedbacks(bytes32 feedbackHash) external view returns (
        address reviewer,
        uint256 reviewerAgentId,
        uint8 score,
        bytes32 skillTag,
        string memory feedbackUri,
        bytes32 feedbackCommitment,
        uint256 timestamp,
        bytes32 dealId
    );

    function reputationBySkill(uint256 agentId, bytes32 skillTag) external view returns (
        uint64 count,
        uint64 totalScore,
        uint256 lastFeedbackAt
    );

    function overallReputation(uint256 agentId) external view returns (
        uint64 count,
        uint64 totalScore,
        uint256 lastFeedbackAt
    );

    function revokedFeedback(uint256 agentId, address client, uint64 index) external view returns (bool);

    function setIdentityRegistry(address _identityRegistry) external;
}
