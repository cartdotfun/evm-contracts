// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ReputationRegistry
 * @dev ERC-8004 compliant Reputation Registry for AI Agents
 *
 * Provides a standardized interface for posting and fetching feedback signals.
 * Feedback is skill-tagged and aggregated on-chain for gas-efficient reads.
 */
contract ReputationRegistry is Ownable {
    // Reference to IdentityRegistry
    address public identityRegistry;

    // Feedback record
    struct Feedback {
        address reviewer; // Who posted the feedback
        uint256 reviewerAgentId; // Reviewer's agent ID (0 if not an agent)
        uint8 score; // 0-100 score
        bytes32 skillTag; // e.g., keccak256("code_review")
        string feedbackUri; // Points to detailed feedback JSON
        bytes32 feedbackHash; // Commitment hash
        uint256 timestamp;
        bytes32 dealId; // Associated deal (optional, 0x0 if none)
    }

    // Aggregated reputation per agent per skill
    struct ReputationSummary {
        uint64 count;
        uint64 totalScore; // Sum of all scores (for avg calculation)
        uint256 lastFeedbackAt;
    }

    // agentId => list of feedback hashes
    mapping(uint256 => bytes32[]) public agentFeedbackHashes;

    // feedbackHash => Feedback
    mapping(bytes32 => Feedback) public feedbacks;

    // agentId => skillTag => ReputationSummary
    mapping(uint256 => mapping(bytes32 => ReputationSummary))
        public reputationBySkill;

    // agentId => overall ReputationSummary (skill-agnostic)
    mapping(uint256 => ReputationSummary) public overallReputation;

    // Counter for unique feedback IDs
    uint256 private _feedbackNonce;

    // Events per ERC-8004 spec
    event FeedbackPosted(
        uint256 indexed agentId,
        address indexed reviewer,
        bytes32 indexed feedbackHash,
        uint8 score,
        bytes32 skillTag,
        bytes32 dealId
    );

    constructor(
        address _identityRegistry,
        address _initialOwner
    ) Ownable(_initialOwner) {
        identityRegistry = _identityRegistry;
    }

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
    ) external {
        require(agentId > 0, "Invalid agent ID");
        require(score <= 100, "Score must be 0-100");

        // Generate unique feedback hash if not provided
        bytes32 finalHash = feedbackHash;
        if (finalHash == bytes32(0)) {
            finalHash = keccak256(
                abi.encodePacked(
                    agentId,
                    msg.sender,
                    score,
                    skillTag,
                    block.timestamp,
                    ++_feedbackNonce
                )
            );
        }

        require(feedbacks[finalHash].timestamp == 0, "Feedback already exists");

        // Get reviewer's agent ID if they're registered
        uint256 reviewerAgentId = 0;
        // Could call identityRegistry.getAgentByOwner(msg.sender) but keeping gas efficient

        // Store feedback
        feedbacks[finalHash] = Feedback({
            reviewer: msg.sender,
            reviewerAgentId: reviewerAgentId,
            score: score,
            skillTag: skillTag,
            feedbackUri: feedbackUri,
            feedbackHash: finalHash,
            timestamp: block.timestamp,
            dealId: dealId
        });

        agentFeedbackHashes[agentId].push(finalHash);

        // Update skill-specific aggregation
        if (skillTag != bytes32(0)) {
            ReputationSummary storage skillRep = reputationBySkill[agentId][
                skillTag
            ];
            skillRep.count++;
            skillRep.totalScore += score;
            skillRep.lastFeedbackAt = block.timestamp;
        }

        // Update overall aggregation
        ReputationSummary storage overall = overallReputation[agentId];
        overall.count++;
        overall.totalScore += score;
        overall.lastFeedbackAt = block.timestamp;

        emit FeedbackPosted(
            agentId,
            msg.sender,
            finalHash,
            score,
            skillTag,
            dealId
        );
    }

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
    ) external view returns (uint64 count, uint8 avgScore) {
        ReputationSummary storage summary;

        if (skillTag == bytes32(0)) {
            summary = overallReputation[agentId];
        } else {
            summary = reputationBySkill[agentId][skillTag];
        }

        count = summary.count;
        if (count > 0) {
            avgScore = uint8(summary.totalScore / count);
        } else {
            avgScore = 0;
        }
    }

    /**
     * @dev Get all feedback hashes for an agent
     * @param agentId The agent to query
     * @return Array of feedback hashes
     */
    function getFeedbackHashes(
        uint256 agentId
    ) external view returns (bytes32[] memory) {
        return agentFeedbackHashes[agentId];
    }

    /**
     * @dev Get feedback details by hash
     * @param feedbackHash The feedback hash to query
     * @return feedback The feedback record
     */
    function getFeedback(
        bytes32 feedbackHash
    ) external view returns (Feedback memory) {
        return feedbacks[feedbackHash];
    }

    /**
     * @dev Get feedback count for an agent
     * @param agentId The agent to query
     * @return count Number of feedbacks
     */
    function getFeedbackCount(uint256 agentId) external view returns (uint256) {
        return agentFeedbackHashes[agentId].length;
    }

    /**
     * @dev Update identity registry address (owner only)
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        identityRegistry = _identityRegistry;
    }
}
