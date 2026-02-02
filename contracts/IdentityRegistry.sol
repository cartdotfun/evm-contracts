// SPDX-License-Identifier: MIT
// @author: Lloyd Faulk
// @author: Opus 4.5
// @version: 2.0.0 (Upgradeable)

pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721URIStorageUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IIdentityRegistry.sol";

/**
 * @title IdentityRegistry
 * @dev ERC-8004 compliant Identity Registry for AI Agents (Upgradeable)
 *
 * Each agent receives a unique AgentID (ERC-721 NFT) that maps to:
 * - Their Ethereum address
 * - An off-chain registration file containing metadata about capabilities
 *
 * Supports on-chain metadata via getMetadata/setMetadata per ERC-8004 spec.
 * Includes Staking logic for Trust Score.
 */
contract IdentityRegistry is
    Initializable,
    ERC721Upgradeable,
    ERC721URIStorageUpgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    IIdentityRegistry
{
    using SafeERC20 for IERC20;

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

    // Staking
    IERC20 public stakingToken;
    mapping(uint256 => uint256) public agentStakes;

    // Events
    event Staked(uint256 indexed agentId, uint256 amount);
    event Unstaked(uint256 indexed agentId, uint256 amount);
    event StakingTokenUpdated(address token);

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[50] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _initialOwner, address _stakingToken) public initializer {
        __ERC721_init("Cart.fun Agent", "CART");
        __ERC721URIStorage_init();
        __Ownable_init(_initialOwner);
        __UUPSUpgradeable_init();

        _nextAgentId = 1;
        stakingToken = IERC20(_stakingToken);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ═══════════════════════════════════════════════════════════════════════
    // Core Functions
    // ═══════════════════════════════════════════════════════════════════════

    function register(
        string calldata registrationUri,
        bytes32 registrationHash
    ) external returns (uint256 agentId) {
        require(bytes(registrationUri).length > 0, "Registration URI required");
        agentId = _registerAgent(msg.sender, registrationUri, registrationHash);
        emit AgentRegistered(agentId, msg.sender, registrationUri, registrationHash);
    }

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

    function getAgentByOwner(
        address owner
    ) external view returns (uint256 agentId) {
        return addressToAgentId[owner];
    }

    function isRegistered(address addr) external view returns (bool) {
        return addressToAgentId[addr] != 0;
    }

    function totalAgents() external view returns (uint256) {
        return _nextAgentId - 1;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Staking Functions
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Stake CART tokens to increase Trust Score.
     * @param agentId The agent ID to stake for.
     * @param amount The amount of CART to stake.
     */
    function stake(uint256 agentId, uint256 amount) external {
        require(ownerOf(agentId) == msg.sender, "Not agent owner");
        require(amount > 0, "Amount must be > 0");
        require(address(stakingToken) != address(0), "Staking token not set");

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        agentStakes[agentId] += amount;

        emit Staked(agentId, amount);
    }

    /**
     * @dev Unstake CART tokens.
     * @param agentId The agent ID to unstake from.
     * @param amount The amount of CART to unstake.
     */
    function unstake(uint256 agentId, uint256 amount) external {
        require(ownerOf(agentId) == msg.sender, "Not agent owner");
        require(agentStakes[agentId] >= amount, "Insufficient stake");

        agentStakes[agentId] -= amount;
        stakingToken.safeTransfer(msg.sender, amount);

        emit Unstaked(agentId, amount);
    }

    /**
     * @dev Admin function to update the staking token.
     * @param _token New token address.
     */
    function setStakingToken(address _token) external onlyOwner {
        stakingToken = IERC20(_token);
        emit StakingTokenUpdated(_token);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ERC-8004 Overloads
    // ═══════════════════════════════════════════════════════════════════════

    function register(
        string calldata _tokenURI,
        MetadataEntry[] calldata metadata
    ) external returns (uint256 agentId) {
        agentId = _registerAgent(msg.sender, _tokenURI, bytes32(0));
        for (uint256 i = 0; i < metadata.length; i++) {
            _metadata[agentId][metadata[i].key] = metadata[i].value;
            emit MetadataSet(agentId, metadata[i].key, metadata[i].key, metadata[i].value);
        }
        emit Registered(agentId, _tokenURI, msg.sender);
    }

    function register(
        string calldata _tokenURI
    ) external returns (uint256 agentId) {
        agentId = _registerAgent(msg.sender, _tokenURI, bytes32(0));
        emit Registered(agentId, _tokenURI, msg.sender);
    }

    function register() external returns (uint256 agentId) {
        agentId = _registerAgent(msg.sender, "", bytes32(0));
        emit Registered(agentId, "", msg.sender);
    }

    function getMetadata(
        uint256 agentId,
        string calldata key
    ) external view returns (bytes memory value) {
        return _metadata[agentId][key];
    }

    function setMetadata(
        uint256 agentId,
        string calldata key,
        bytes calldata value
    ) external {
        require(
            ownerOf(agentId) == msg.sender || _isAuthorized(ownerOf(agentId), msg.sender, agentId),
            "Not authorized"
        );
        _metadata[agentId][key] = value;
        emit MetadataSet(agentId, key, key, value);
    }

    // Overrides
    function tokenURI(uint256 tokenId) public view override(ERC721Upgradeable, ERC721URIStorageUpgradeable) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721Upgradeable, ERC721URIStorageUpgradeable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

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
