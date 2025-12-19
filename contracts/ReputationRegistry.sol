// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

// Interface for IdentityRegistry ownership check
interface IIdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
}

/**
 * @title ReputationRegistry
 * @dev ERC-8004 compliant Reputation Registry for AI Agents
 *
 * Provides a standardized interface for posting and fetching feedback signals.
 * Supports both:
 * - Simple postFeedback (anyone can post)
 * - ERC-8004 giveFeedback (requires agent signature authorization)
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

    // ERC-8004: agentId => clientAddress => lastIndex (for indexLimit tracking)
    mapping(uint256 => mapping(address => uint64)) private _lastIndices;

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

    // ERC-8004 event for giveFeedback
    event NewFeedback(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint8 score,
        bytes32 tag1,
        bytes32 tag2,
        string fileuri,
        bytes32 filehash
    );

    // ERC-8004 event for revokeFeedback
    event FeedbackRevoked(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 indexed feedbackIndex
    );

    // ERC-8004 event for appendResponse
    event ResponseAppended(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        address indexed responder,
        string responseUri
    );

    // ERC-8004: Track revoked feedback (agentId => clientAddress => feedbackIndex => isRevoked)
    mapping(uint256 => mapping(address => mapping(uint64 => bool)))
        public revokedFeedback;

    // ERC-8004: Track responses (agentId => clientAddress => feedbackIndex => responses)
    mapping(uint256 => mapping(address => mapping(uint64 => string[])))
        private _responses;

    // ERC-8004: Track clients per agent
    mapping(uint256 => address[]) private _agentClients;
    mapping(uint256 => mapping(address => bool)) private _isClient;

    // ERC-8004: Stored feedback by index
    struct ERC8004Feedback {
        uint8 score;
        bytes32 tag1;
        bytes32 tag2;
        bool isRevoked;
    }
    mapping(uint256 => mapping(address => mapping(uint64 => ERC8004Feedback)))
        private _feedbackByIndex;

    constructor(
        address _identityRegistry,
        address _initialOwner
    ) Ownable(_initialOwner) {
        identityRegistry = _identityRegistry;
    }

    /**
     * @dev Get the identity registry address (ERC-8004 required)
     */
    function getIdentityRegistry() external view returns (address) {
        return identityRegistry;
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

    // ═══════════════════════════════════════════════════════════════════════
    // ERC-8004 Compliant Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Give feedback with EIP-712/EIP-191 signature verification
     * feedbackAuth structure: (agentId, clientAddress, indexLimit, expiry, chainId, identityRegistry, signerAddress)
     *
     * The agent must pre-sign this authorization for the client to submit feedback.
     * This prevents spam and ensures only authorized clients can rate agents.
     *
     * @param agentId The agent receiving feedback
     * @param score Score from 0-100
     * @param tag1 Primary skill tag (e.g., keccak256("code_review"))
     * @param tag2 Secondary tag (optional)
     * @param fileuri URI pointing to detailed feedback JSON
     * @param filehash Hash commitment of feedback data
     * @param feedbackAuth Encoded authorization: (indexLimit, expiry, signerAddress, signature)
     */
    function giveFeedback(
        uint256 agentId,
        uint8 score,
        bytes32 tag1,
        bytes32 tag2,
        string calldata fileuri,
        bytes32 filehash,
        bytes memory feedbackAuth
    ) external {
        require(score <= 100, "Score must be 0-100");

        // Verify signature and get index
        uint64 index = _verifyAndGetIndex(agentId, feedbackAuth);

        // Store in ERC-8004 format
        _storeFeedbackERC8004(
            agentId,
            msg.sender,
            index,
            score,
            tag1,
            tag2,
            fileuri,
            filehash
        );
    }

    /**
     * @dev Internal: Verify feedbackAuth signature and return new index
     */
    function _verifyAndGetIndex(
        uint256 agentId,
        bytes memory feedbackAuth
    ) internal returns (uint64) {
        // Decode feedbackAuth: (indexLimit, expiry, signerAddress, signature)
        (
            uint64 indexLimit,
            uint64 expiry,
            address signer,
            bytes memory sig
        ) = abi.decode(feedbackAuth, (uint64, uint64, address, bytes));

        require(block.timestamp < expiry, "Authorization expired");
        require(
            _lastIndices[agentId][msg.sender] < indexLimit,
            "Index limit reached"
        );
        require(
            signer == IIdentityRegistry(identityRegistry).ownerOf(agentId),
            "Invalid signer"
        );

        // Reconstruct and verify the signed hash
        bytes32 structHash = keccak256(
            abi.encodePacked(
                agentId,
                msg.sender,
                indexLimit,
                expiry,
                block.chainid,
                identityRegistry,
                signer
            )
        );
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", structHash)
        );

        require(
            SignatureChecker.isValidSignatureNow(signer, ethSignedHash, sig),
            "Invalid signature"
        );

        // Increment and return index
        uint64 newIndex = _lastIndices[agentId][msg.sender] + 1;
        _lastIndices[agentId][msg.sender] = newIndex;
        return newIndex;
    }

    /**
     * @dev Internal: Store feedback in ERC-8004 format
     */
    function _storeFeedbackERC8004(
        uint256 agentId,
        address client,
        uint64 index,
        uint8 score,
        bytes32 tag1,
        bytes32 tag2,
        string calldata fileuri,
        bytes32 filehash
    ) internal {
        bytes32 feedbackId = keccak256(
            abi.encodePacked(agentId, client, index)
        );

        feedbacks[feedbackId] = Feedback({
            reviewer: client,
            reviewerAgentId: 0,
            score: score,
            skillTag: tag1,
            feedbackUri: fileuri,
            feedbackHash: filehash,
            timestamp: block.timestamp,
            dealId: bytes32(0)
        });

        agentFeedbackHashes[agentId].push(feedbackId);

        // Track client list
        if (!_isClient[agentId][client]) {
            _isClient[agentId][client] = true;
            _agentClients[agentId].push(client);
        }

        // Store structured feedback for ERC-8004 reads
        _feedbackByIndex[agentId][client][index] = ERC8004Feedback({
            score: score,
            tag1: tag1,
            tag2: tag2,
            isRevoked: false
        });

        // Update aggregations
        _updateAggregations(agentId, score, tag1);

        emit NewFeedback(agentId, client, score, tag1, tag2, fileuri, filehash);
    }

    /**
     * @dev Internal: Update reputation aggregations
     */
    function _updateAggregations(
        uint256 agentId,
        uint8 score,
        bytes32 tag1
    ) internal {
        if (tag1 != bytes32(0)) {
            ReputationSummary storage skillRep = reputationBySkill[agentId][
                tag1
            ];
            skillRep.count++;
            skillRep.totalScore += score;
            skillRep.lastFeedbackAt = block.timestamp;
        }

        ReputationSummary storage overall = overallReputation[agentId];
        overall.count++;
        overall.totalScore += score;
        overall.lastFeedbackAt = block.timestamp;
    }

    /**
     * @dev Get the last feedback index for a client-agent pair
     * @param agentId The agent ID
     * @param clientAddress The client address
     * @return The last index used by this client for this agent
     */
    function getLastIndex(
        uint256 agentId,
        address clientAddress
    ) external view returns (uint64) {
        return _lastIndices[agentId][clientAddress];
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ERC-8004 Feedback Management Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Revoke feedback (ERC-8004)
     * Only the original client can revoke their feedback
     */
    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external {
        require(
            feedbackIndex <= _lastIndices[agentId][msg.sender],
            "Invalid index"
        );
        require(
            !revokedFeedback[agentId][msg.sender][feedbackIndex],
            "Already revoked"
        );

        revokedFeedback[agentId][msg.sender][feedbackIndex] = true;
        _feedbackByIndex[agentId][msg.sender][feedbackIndex].isRevoked = true;

        emit FeedbackRevoked(agentId, msg.sender, feedbackIndex);
    }

    /**
     * @dev Append response to feedback (ERC-8004)
     * Anyone can append a response (e.g., agent showing refund, spam tagging)
     */
    function appendResponse(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        string calldata responseUri,
        bytes32 responseHash
    ) external {
        require(
            feedbackIndex <= _lastIndices[agentId][clientAddress],
            "Invalid index"
        );

        _responses[agentId][clientAddress][feedbackIndex].push(responseUri);

        emit ResponseAppended(
            agentId,
            clientAddress,
            feedbackIndex,
            msg.sender,
            responseUri
        );
    }

    /**
     * @dev Read a single feedback (ERC-8004)
     */
    function readFeedback(
        uint256 agentId,
        address clientAddress,
        uint64 index
    )
        external
        view
        returns (uint8 score, bytes32 tag1, bytes32 tag2, bool isRevoked)
    {
        ERC8004Feedback storage fb = _feedbackByIndex[agentId][clientAddress][
            index
        ];
        return (fb.score, fb.tag1, fb.tag2, fb.isRevoked);
    }

    /**
     * @dev Read all feedback for an agent with optional filtering (ERC-8004)
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
        )
    {
        // Use provided clients or get all clients
        address[] memory targetClients;
        if (clientAddresses.length > 0) {
            targetClients = new address[](clientAddresses.length);
            for (uint256 i = 0; i < clientAddresses.length; i++) {
                targetClients[i] = clientAddresses[i];
            }
        } else {
            targetClients = _agentClients[agentId];
        }

        // Count matching feedback
        uint256 count = 0;
        for (uint256 i = 0; i < targetClients.length; i++) {
            address client = targetClients[i];
            uint64 lastIdx = _lastIndices[agentId][client];
            for (uint64 j = 1; j <= lastIdx; j++) {
                ERC8004Feedback storage fb = _feedbackByIndex[agentId][client][
                    j
                ];
                if (!includeRevoked && fb.isRevoked) continue;
                if (tag1 != bytes32(0) && fb.tag1 != tag1) continue;
                if (tag2 != bytes32(0) && fb.tag2 != tag2) continue;
                count++;
            }
        }

        // Allocate arrays
        clients = new address[](count);
        scores = new uint8[](count);
        tag1s = new bytes32[](count);
        tag2s = new bytes32[](count);
        revokedStatuses = new bool[](count);

        // Fill arrays
        uint256 idx = 0;
        for (uint256 i = 0; i < targetClients.length; i++) {
            address client = targetClients[i];
            uint64 lastIdx = _lastIndices[agentId][client];
            for (uint64 j = 1; j <= lastIdx; j++) {
                ERC8004Feedback storage fb = _feedbackByIndex[agentId][client][
                    j
                ];
                if (!includeRevoked && fb.isRevoked) continue;
                if (tag1 != bytes32(0) && fb.tag1 != tag1) continue;
                if (tag2 != bytes32(0) && fb.tag2 != tag2) continue;

                clients[idx] = client;
                scores[idx] = fb.score;
                tag1s[idx] = fb.tag1;
                tag2s[idx] = fb.tag2;
                revokedStatuses[idx] = fb.isRevoked;
                idx++;
            }
        }
    }

    /**
     * @dev Get all clients who have given feedback to an agent (ERC-8004)
     */
    function getClients(
        uint256 agentId
    ) external view returns (address[] memory) {
        return _agentClients[agentId];
    }

    /**
     * @dev Get response count for a feedback (ERC-8004)
     */
    function getResponseCount(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        address[] calldata responders
    ) external view returns (uint64) {
        // For simplicity, return total response count
        // Filtering by responders would require storing responder addresses
        return uint64(_responses[agentId][clientAddress][feedbackIndex].length);
    }

    /**
     * @dev Update identity registry address (owner only)
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        identityRegistry = _identityRegistry;
    }
}
