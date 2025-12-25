// SPDX-License-Identifier: MIT
// @author: Lloyd Faulk
// @author: Opus 4.5
// @version: 1.0.0

pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./interfaces/IGatewaySession.sol";
import "./interfaces/ITrustEngine.sol";

/**
 * @title GatewaySession
 * @dev Manages x402-style payment sessions for cart.fun Gateway.
 *      Sessions allow agents to pre-fund API usage and settle in batches.
 *      Works with TrustEngine for balance management.
 */
contract GatewaySession is ReentrancyGuard, Ownable, IGatewaySession {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ═══════════════════════════════════════════════════════════════════════
    // Security Constants
    // ═══════════════════════════════════════════════════════════════════════
    uint256 public constant MAX_SLUG_LENGTH = 32;
    uint256 public constant MAX_SESSION_DURATION = 7 days;

    ITrustEngine public trustEngine;

    // Session storage
    mapping(bytes32 => Session) public override sessions;

    // Gateway registry: slug -> provider address
    mapping(string => address) public override gateways;

    // Gateway pricing: slug -> price per request (in token units)
    mapping(string => uint256) public override gatewayPricing;

    // Nonce for generating unique session IDs
    mapping(address => uint256) public agentNonces;

    // Track active sessions per provider to prevent gateway deactivation with active sessions
    mapping(address => uint256) public activeSessionsByProvider;

    // Track session IDs per provider (for getActiveSessions query)
    mapping(address => bytes32[]) private providerSessions;
    // Index of session in providerSessions array (for efficient removal)
    mapping(bytes32 => uint256) private sessionIndex;

    constructor(
        address _trustEngine,
        address _initialOwner
    ) Ownable(_initialOwner) {
        trustEngine = ITrustEngine(_trustEngine);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Admin Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Update TrustEngine address (only owner)
     * @param _trustEngine Address of the new TrustEngine contract
     */
    function setTrustEngine(address _trustEngine) external onlyOwner {
        require(_trustEngine != address(0), "Invalid TrustEngine address");
        trustEngine = ITrustEngine(_trustEngine);
        emit TrustEngineUpdated(_trustEngine);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Gateway Registry Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Register a new gateway (API owner registers their endpoint)
     * @param _slug Unique identifier for the gateway (e.g., "my-api")
     * @param _pricePerRequest Price per API request in token units
     */
    function registerGateway(
        string calldata _slug,
        uint256 _pricePerRequest
    ) external {
        require(bytes(_slug).length > 0, "Slug cannot be empty");
        require(bytes(_slug).length <= MAX_SLUG_LENGTH, "Slug too long");
        require(gateways[_slug] == address(0), "Gateway already exists");
        require(_pricePerRequest > 0, "Price must be > 0");

        gateways[_slug] = msg.sender;
        gatewayPricing[_slug] = _pricePerRequest;

        emit GatewayRegistered(_slug, msg.sender, _pricePerRequest);
    }

    /**
     * @dev Update gateway pricing (only gateway owner)
     */
    function updateGatewayPrice(
        string calldata _slug,
        uint256 _newPrice
    ) external {
        require(gateways[_slug] == msg.sender, "Not gateway owner");
        require(_newPrice > 0, "Price must be > 0");

        gatewayPricing[_slug] = _newPrice;
        emit GatewayUpdated(_slug, _newPrice);
    }

    /**
     * @dev Deactivate a gateway (only gateway owner)
     * @notice Cannot deactivate if there are active sessions for this provider
     */
    function deactivateGateway(string calldata _slug) external {
        require(gateways[_slug] == msg.sender, "Not gateway owner");
        require(
            activeSessionsByProvider[msg.sender] == 0,
            "Cannot deactivate with active sessions"
        );

        gateways[_slug] = address(0);
        gatewayPricing[_slug] = 0;

        emit GatewayDeactivated(_slug);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Session Lifecycle Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Open a new session for a gateway
     * @param _gatewaySlug Gateway identifier
     * @param _token Payment token address
     * @param _deposit Amount to lock for this session
     * @param _duration Session duration in seconds
     * @return sessionId The unique session identifier
     */
    function openSession(
        string calldata _gatewaySlug,
        address _token,
        uint256 _deposit,
        uint256 _duration
    ) external nonReentrant returns (bytes32 sessionId) {
        address provider = gateways[_gatewaySlug];
        require(provider != address(0), "Gateway not found");
        require(_token != address(0), "Invalid token address");
        require(_deposit > 0, "Deposit must be > 0");
        require(
            _duration > 0 && _duration <= MAX_SESSION_DURATION,
            "Invalid duration"
        );

        // Check agent has sufficient balance in TrustEngine
        uint256 balance = trustEngine.balances(msg.sender, _token);
        require(balance >= _deposit, "Insufficient TrustEngine balance");

        // Generate unique session ID
        uint256 nonce = agentNonces[msg.sender]++;
        sessionId = keccak256(
            abi.encodePacked(
                msg.sender,
                provider,
                _gatewaySlug,
                nonce,
                block.timestamp
            )
        );

        uint256 expiresAt = block.timestamp + _duration;

        // Create session record
        sessions[sessionId] = Session({
            agent: msg.sender,
            provider: provider,
            token: _token,
            depositAmount: _deposit,
            usedAmount: 0,
            createdAt: block.timestamp,
            expiresAt: expiresAt,
            state: SessionState.ACTIVE,
            gatewaySlug: _gatewaySlug
        });

        // Track active session for provider (prevent gateway deactivation)
        activeSessionsByProvider[provider]++;

        // Track session ID for getActiveSessions query
        sessionIndex[sessionId] = providerSessions[provider].length;
        providerSessions[provider].push(sessionId);

        // Lock funds in TrustEngine
        trustEngine.lockForSession(
            sessionId,
            msg.sender,
            provider,
            _token,
            _deposit
        );

        emit SessionOpened(
            sessionId,
            msg.sender,
            provider,
            _gatewaySlug,
            _deposit,
            expiresAt
        );

        return sessionId;
    }

    /**
     * @dev Record API usage for a session (called by provider/proxy)
     *      Provider signs off on usage, or this can be called directly by the proxy
     * @param _sessionId Session identifier
     * @param _amount Usage amount to add
     */
    function recordUsage(
        bytes32 _sessionId,
        uint256 _amount
    ) external nonReentrant {
        Session storage session = sessions[_sessionId];
        require(session.state == SessionState.ACTIVE, "Session not active");
        require(block.timestamp < session.expiresAt, "Session expired");
        require(
            msg.sender == session.provider,
            "Only provider can record usage"
        );

        uint256 newUsed = session.usedAmount + _amount;
        require(newUsed <= session.depositAmount, "Usage exceeds deposit");

        session.usedAmount = newUsed;

        emit UsageRecorded(_sessionId, _amount, newUsed);
    }

    /**
     * @dev Settle a session: distribute funds based on usage
     *      Can be called by agent, provider, or anyone after expiry
     * @param _sessionId Session identifier
     */
    function settleSession(bytes32 _sessionId) external nonReentrant {
        Session storage session = sessions[_sessionId];
        require(session.state == SessionState.ACTIVE, "Session not active");
        require(
            msg.sender == session.agent ||
                msg.sender == session.provider ||
                block.timestamp >= session.expiresAt,
            "Not authorized to settle"
        );

        // Effects first (CEI pattern)
        session.state = SessionState.SETTLED;
        uint256 refunded = session.depositAmount - session.usedAmount;

        // Decrement active session count for provider
        if (activeSessionsByProvider[session.provider] > 0) {
            activeSessionsByProvider[session.provider]--;
        }

        // Remove session from provider's session list
        _removeSessionFromProvider(session.provider, _sessionId);

        // Interactions: Unlock in TrustEngine
        trustEngine.unlockSession(_sessionId, session.usedAmount);

        emit SessionSettled(_sessionId, session.usedAmount, refunded);
    }

    /**
     * @dev Cancel a session and refund agent (only if no usage recorded)
     *      Used for emergency cancellation
     * @param _sessionId Session identifier
     */
    function cancelSession(bytes32 _sessionId) external nonReentrant {
        Session storage session = sessions[_sessionId];
        require(session.state == SessionState.ACTIVE, "Session not active");
        require(msg.sender == session.agent, "Only agent can cancel");
        require(session.usedAmount == 0, "Cannot cancel session with usage");

        // Effects first (CEI pattern)
        session.state = SessionState.CANCELLED;

        // Decrement active session count for provider
        if (activeSessionsByProvider[session.provider] > 0) {
            activeSessionsByProvider[session.provider]--;
        }

        // Remove session from provider's session list
        _removeSessionFromProvider(session.provider, _sessionId);

        // Interactions: Full refund to agent
        trustEngine.unlockSession(_sessionId, 0);

        emit SessionCancelled(_sessionId, session.depositAmount);
    }

    /**
     * @dev Renew/extend an active session
     *      Only the agent can renew. Extension is from current time, not from expiry.
     * @param _sessionId Session identifier
     * @param _extension Additional duration in seconds (max MAX_SESSION_DURATION)
     */
    function renewSession(
        bytes32 _sessionId,
        uint256 _extension
    ) external nonReentrant {
        Session storage session = sessions[_sessionId];
        require(session.state == SessionState.ACTIVE, "Session not active");
        require(msg.sender == session.agent, "Only agent can renew");
        require(
            _extension > 0 && _extension <= MAX_SESSION_DURATION,
            "Invalid extension"
        );

        // Extend from current time (prevents stacking)
        session.expiresAt = block.timestamp + _extension;

        emit SessionRenewed(_sessionId, session.expiresAt);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // View Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Get remaining credits for a session
     */
    function getRemainingCredits(
        bytes32 _sessionId
    ) external view returns (uint256) {
        Session memory session = sessions[_sessionId];
        if (session.state != SessionState.ACTIVE) return 0;
        return session.depositAmount - session.usedAmount;
    }

    /**
     * @dev Check if session is still valid (active and not expired)
     */
    function isSessionValid(bytes32 _sessionId) external view returns (bool) {
        Session memory session = sessions[_sessionId];
        return
            session.state == SessionState.ACTIVE &&
            block.timestamp < session.expiresAt;
    }

    /**
     * @dev Get full session details
     */
    function getSession(
        bytes32 _sessionId
    )
        external
        view
        returns (
            address agent,
            address provider,
            address token,
            uint256 depositAmount,
            uint256 usedAmount,
            uint256 expiresAt,
            SessionState state,
            string memory gatewaySlug
        )
    {
        Session memory session = sessions[_sessionId];
        return (
            session.agent,
            session.provider,
            session.token,
            session.depositAmount,
            session.usedAmount,
            session.expiresAt,
            session.state,
            session.gatewaySlug
        );
    }

    /**
     * @dev Get gateway details
     */
    function getGateway(
        string calldata _slug
    ) external view returns (address provider, uint256 pricePerRequest) {
        return (gateways[_slug], gatewayPricing[_slug]);
    }

    /**
     * @dev Get all active session IDs for a provider
     * @param _provider Provider address
     * @return sessionIds Array of active session IDs
     */
    function getActiveSessions(
        address _provider
    ) external view returns (bytes32[] memory) {
        return providerSessions[_provider];
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Internal Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Remove a session from provider's session list (swap and pop)
     */
    function _removeSessionFromProvider(
        address _provider,
        bytes32 _sessionId
    ) internal {
        bytes32[] storage sessions_ = providerSessions[_provider];
        uint256 index = sessionIndex[_sessionId];
        uint256 lastIndex = sessions_.length - 1;

        if (index != lastIndex) {
            bytes32 lastSessionId = sessions_[lastIndex];
            sessions_[index] = lastSessionId;
            sessionIndex[lastSessionId] = index;
        }

        sessions_.pop();
        delete sessionIndex[_sessionId];
    }
}
