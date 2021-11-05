// SPDX-License-Identifier: MIT

import "../libraries/math/SafeMath.sol";
import "../libraries/utils/ReentrancyGuard.sol";
import "../peripherals/Reader.sol";
import "../core/interfaces/IRouter.sol";
import "../core/interfaces/IVault.sol";
import "./interfaces/IUniswapV2Router.sol";
import "../libraries/token/IERC20.sol";

import "hardhat/console.sol";

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;


contract MirrorTrading is ReentrancyGuard {
    using SafeMath for uint256;

    Reader readerContract;

    address public gov;
    address public keeper;

    struct Position{
        uint256 positionInUsd; 
        uint256 collateralInUsd;
        uint256 averagePrice;
        uint256 entryFundingRage;
        uint256 reserveAmount;
        uint256 realisedPnl;
        bool hasProfit;
        uint256 lastIncreasedTime;
    }

    struct Follows {
        address puppet;
        address master;
        bool isFollowing;
    }

    struct MirrorTrade {   
        //INDEX IN FOLLOWS ARRAY
        uint index;
        address puppet;
        address master;     
        bool isActive;
        uint256 startedFollowingTime;
    }

    struct PuppetTrader {
        //INDEX IN ACCOUNTS ARRAY
        uint index;
        uint gmxIndex;
        uint256 joinedDate;
        //MAPS ADDRESS OF MASTER to MirrorTrade 
        address[] followedMasters;
        mapping (address => MirrorTrade) mirrorTrades;    
    }
    //MIRROR POSITION MAPPINGS PUPPET FORLLOWING => MASTER
    mapping (address => PuppetTrader) public mirrorPositions;


    //KEEPS TRACK OF ALL ACTIVE FOLLOWS    
    Follows[] public followsArray;

    //KEEP TRACK OF ALL PUPPET ACCOUNTS
    address[] public puppetAccounts;

    event FollowingTrader(        
        address puppet,
        address master,        
        bool isActive,        
        uint256 startedFollowingTime
    );

   event IncreasePosition(
        address _caller,        
        bytes32 key,
        address account,
        address collateralToken,
        address indexToken,
        uint256 collateralDelta, //(sizeDelta/collateralDelta) * X Amount
        uint256 sizeDelta,
        bool isLong,
        uint256 price,
        uint256 fee
    );

   event DecreasePosition(
        address _caller, 
        address account,
        address collateralToken,
        address indexToken,
        uint256 collateralDelta,
        uint256 sizeDelta,
        bool isLong,
        uint256 price,
        uint256 fee
    );

   event LiquidatePosition(
        bytes32 key,
        address account,
        address collateralToken,
        address indexToken,
        bool isLong,
        uint256 size,
        uint256 collateral,
        uint256 reserveAmount,
        int256 realisedPnl,
        uint256 markPrice
    );

    event unFollowingTrader(        
        address puppet,
        address master,        
        bool isActive,        
        uint256 unFollowingTime
    );

    modifier onlyGov() {
        require(msg.sender == gov, "MirrorTading: forbidden");
        _;
    }

    modifier onlyKeeper() {
        require(msg.sender == keeper, "MirrorTading: forbidden");
        _;
    }

    constructor(address _readerAddress) public {
        keeper = msg.sender;
        gov = msg.sender;
        readerContract = Reader(_readerAddress);
    }

    function setGov(address _gov) external onlyGov {
        gov = _gov;
    }


    /// @notice Function that maps the puppet to the master, it'll keep track of the master that the puppet wants to follow
    /// @dev Any address can call it    
    /// @param _master The trader that is being followed 
    function followTrader(address _master ) external {      
        address _puppet = msg.sender;
        PuppetTrader storage puppet = mirrorPositions[_puppet];  

        address checkIfFollowingMaster= puppet.mirrorTrades[_master].master;
        uint256 checkIfUserHasBeenAlreadyAdded = puppet.joinedDate;
        bool notFollowingMaster = checkIfFollowingMaster == 0x0000000000000000000000000000000000000000 ? true : false;                        
                        
        require(notFollowingMaster, "Mirror: Already Following this master");
        
        puppet.joinedDate = now;
        puppet.mirrorTrades[_master].puppet = _puppet;
        puppet.mirrorTrades[_master].master = _master;
        puppet.mirrorTrades[_master].isActive = true;
        puppet.mirrorTrades[_master].startedFollowingTime = now;
        puppet.followedMasters.push(_master);
                

        followsArray.push(
            Follows({
                puppet: _puppet,
                master: _master,
                isFollowing: true
            })
        );
        
        puppet.mirrorTrades[_master].index = followsArray.length -1;
    
        
        if(checkIfUserHasBeenAlreadyAdded == 0){
            puppetAccounts.push(_puppet);            
        }


        emit FollowingTrader(_puppet, _master, true, now);
         
    }

    /// @notice Function that gets all puppets
    /// @dev Any address can call it
    function getPuppets() view public returns (address[] memory) {
        return puppetAccounts;
    }

    /// @notice Function that gets one puppets
    /// @dev Any address can call it
    function getPuppet(address _puppet) view public returns (uint256) {
        return (mirrorPositions[_puppet].joinedDate);
    }

    /// @notice Function that gets one puppets
    /// @dev Any address can call it
    function getAllFollows() view public returns (Follows[] memory) {
        return followsArray;
    }

    /// @notice Function to unfollow a master
    /// @dev Any address can call it
    /// @param _master The trader will be unfollowed
    function unFollow(address _master) external {
        address _puppet = msg.sender;
        PuppetTrader storage puppet = mirrorPositions[_puppet];  
        uint followIndex = puppet.mirrorTrades[_master].index;
        followsArray[followIndex].isFollowing = false;
        emit unFollowingTrader(_puppet, _master, false, now);
        
        //todo DELETE FROM POSITION AS WELL
        //todo check if there's any current position ...
        //todo check if the position can be liquidated ....

    }

    /// @notice Function to check status of a follow
    /// @dev Any address can call it
    /// @param _master The trader to check against
    function getIfFollowing(address _master) public view returns (bool) {
        address _puppet = msg.sender;
        PuppetTrader storage puppet = mirrorPositions[_puppet];  
        uint followIndex = puppet.mirrorTrades[_master].index;               
        bool isFollowing = followsArray[followIndex].isFollowing;  
        return isFollowing;
    }

    function puppetExists(address _puppet) public view returns (bool) {
        PuppetTrader storage entry = mirrorPositions[_puppet];        
        return _contains(entry);
    }

    function _contains(PuppetTrader memory _entry) private pure returns (bool){        
        return _entry.joinedDate > 0;
    }

    function getMasterPositions(address _master, address _vault,address[] memory _collateralTokens, address[] memory _indexTokens, bool[] memory _isLong) public view returns(uint256[] memory){        
        uint256[] memory positions = readerContract.getPositions(_vault, _master, _collateralTokens, _indexTokens, _isLong);
        return positions;
    }

    function getBalanceOf(address _user, address _token) private view returns(uint256){
        uint256 balanceOf = IERC20(_token).balanceOf(_user);
        return balanceOf;
    }


    function increasePosition(IRouter _router, IVault _vault, address _master, address _collateral, address _indexToken, bool _isLong, address _puppet) onlyKeeper external {

        //1. CHECK IF THERE'S FOLLOW --> DO SOME CHECKS
        //1.1 IF THE MASTER TRADER DID 100 DO 1OO OR MAX BALANCEOF.... (GRETEAR OR LESS COMPARISON)
        //1.2 WE'LL HAVE A TRESHOLD IN THE FUTURE (30% OF LIQUIDITY)
        //2. EMIT EVENT ONCE FINALIZED
            
            (uint256 size,
             uint256 collateral,
             uint256 averagePrice,
             uint256 entryFundingRate,
             /* reserveAmount */,
             uint256 realisedPnl,
             bool hasRealisedProfit,
             uint256 lastIncreasedTime)  = _vault.getPosition(
             _master,
             _collateral,
             _indexToken,
             _isLong
         );        

    
        //  uint256 balanceOfCollateralPuppet = getBalanceOf(_collateral,_puppet);
        //  uint256 balanceOfCollateralMaster = getBalanceOf(_collateral,_master);
        //  uint256 balanceOfIndexPuppet = getBalanceOf(_indexToken,_puppet);
        //  uint256 balanceOfIndexlMaster = IERC20(_indexToken).balanceOf(_master);
        //  console.log("balanceOfCollateral", balanceOfCollateralPuppet);
        //  console.log("balanceOfCollateralMaster",  balanceOfCollateralMaster);

        // console.log("balanceOfIndexPuppet", balanceOfIndexPuppet);
        //  console.log("balanceOfIndexlMaster",  balanceOfIndexlMaster);

         _vault.increasePosition(
            _puppet,
            _collateral,
            _indexToken,
            collateral,
            _isLong
         );
        
    }


}
