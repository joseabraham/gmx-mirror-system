const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { deployContract } = require("../shared/fixtures");
const { swapETHForExactTokens } = require("../shared/UniswapV2Router");
const {
  expandDecimals,
  convertToNormalNumber,
} = require("../shared/utilities");
const { toChainlinkPrice } = require("../shared/chainlink");
const { toUsd } = require("../shared/units");
const { initVault, getEthConfig } = require("../core/Vault/helpers");

use(solidity);

describe("MirrorTrading", function () {
  const provider = waffle.provider;
  const [wallet, user0, user1, user2, user3] = provider.getWallets();
  let mirrorTrading;
  let reader;
  let vault;
  let vaultPriceFeed;
  let router;
  let collateralToken;
  let weth;
  let wethPriceFeed;
  let masterToFollow;
  let decreaseMasterToFollow;
  let isLong;
  let collateralTokenDecimals;
  let indexToken;
  let btc;
  let btcPriceFeead;
  let dai;
  let daiPriceFeed;
  let distributor0;
  let yieldTracker0;
  let glpManager;
  let glp;

  const mintCollateral = async (
    collateralToken,
    weth,
    collateralTokenDecimals,
    account
  ) => {
    if (collateralToken.address !== weth.address) {
      // Swap ETH for USDC
      await swapETHForExactTokens(
        expandDecimals("10", 18),
        expandDecimals("10000", collateralTokenDecimals),
        collateralToken.address,
        account.address,
        account
      );
    } else {
      //DEPOSIT SOME WETH AS COLLATERAL
      const balance0ETH = (await provider.getBalance(account.address)).div(2);
      await collateralToken.connect(account).deposit({ value: balance0ETH });
    }
  };

  beforeEach(async () => {
    btc = await deployContract("Token", []);
    btcPriceFeed = await deployContract("PriceFeed", []);

    dai = await deployContract("Token", []);
    daiPriceFeed = await deployContract("PriceFeed", []);

    weth = await deployContract("Token", []);
    wethPriceFeed = await deployContract("PriceFeed", []);

    vault = await deployContract("Vault", []);
    vaultPriceFeed = await deployContract("VaultPriceFeed", []);

    usdg = await deployContract("USDG", [vault.address]);
    router = await deployContract("Router", [
      vault.address,
      usdg.address,
      weth.address,
    ]);

    await initVault(vault, router, usdg, vaultPriceFeed);

    distributor0 = await deployContract("TimeDistributor", []);
    yieldTracker0 = await deployContract("YieldTracker", [usdg.address]);

    await yieldTracker0.setDistributor(distributor0.address);
    await distributor0.setDistribution(
      [yieldTracker0.address],
      [1000],
      [weth.address]
    );

    await weth.mint(distributor0.address, expandDecimals(5000, 18));
    await usdg.setYieldTrackers([yieldTracker0.address]);

    await vaultPriceFeed.setTokenConfig(
      btc.address,
      btcPriceFeed.address,
      8,
      false
    );
    await vaultPriceFeed.setTokenConfig(
      dai.address,
      daiPriceFeed.address,
      8,
      false
    );
    await vaultPriceFeed.setTokenConfig(
      weth.address,
      wethPriceFeed.address,
      8,
      false
    );

    glp = await deployContract("GLP", []);
    glpManager = await deployContract("GlpManager", [
      vault.address,
      usdg.address,
      glp.address,
      24 * 60 * 60,
    ]);

    reader = await deployContract("Reader", [], "Reader");
    mirrorTrading = await deployContract("MirrorTrading", [reader.address]);

    collateralToken = weth;
    indexToken = weth;
    collateralTokenDecimals = await weth.decimals;
  });

  it("followTrader", async () => {
    //starts following and checks follow event
    await expect(mirrorTrading.followTrader(user1.address)).to.emit(
      mirrorTrading,
      "FollowingTrader"
    );
    let puppetIsCreated = await mirrorTrading.puppetExists(wallet.address);
    await expect(puppetIsCreated).eq(true);
    //checks that only allows to follow once a master
    await expect(mirrorTrading.followTrader(user1.address)).to.be.revertedWith(
      "Mirror: Already Following this master"
    );
    let allPuppets = await mirrorTrading.getPuppets();
    await expect(allPuppets.length).eq(1);
  });

  it("getPuppet", async () => {
    await expect(mirrorTrading.followTrader(user1.address)).to.emit(
      mirrorTrading,
      "FollowingTrader"
    );
    let gettingPuppet = await mirrorTrading.getPuppet(wallet.address);
    await expect(gettingPuppet).to.be.above(0);
  });

  it("getAllFollows", async () => {
    await expect(mirrorTrading.followTrader(user1.address)).to.emit(
      mirrorTrading,
      "FollowingTrader"
    );
    await mirrorTrading.followTrader(user2.address);
    let allFollows = await mirrorTrading.getAllFollows();
    await expect(allFollows.length).eq(2);
  });

  it("unFollow", async () => {
    await expect(mirrorTrading.followTrader(user1.address)).to.emit(
      mirrorTrading,
      "FollowingTrader"
    );
    await mirrorTrading.unFollow(user1.address);
    let getFollowing = await mirrorTrading.getIfFollowing(user1.address);
    await expect(getFollowing).eq(false);
  });

  it("IncreasePosition", async () => {
    await wethPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    await vault.setMaxGasPrice("1000000000000");
    await vault.setTokenConfig(...getEthConfig(weth, wethPriceFeed));
    await vault.setIsLeverageEnabled(true);

    console.log("*** VAULT IS INITIATED INCREASE POSITION ****");

    let positionToFollow = {
      master: user1.address,
      collateral: weth.address,
      indexToken: weth.address,
      sizeDelta: toUsd(50),
      isLong: true,
    };

    await weth.mint(user1.address, expandDecimals(5000, 18));
    console.log("*** MINTED COLLATERAL FOR MASTER ****");
    await weth.connect(user1).transfer(vault.address, expandDecimals(1000, 18));
    await vault.buyUSDG(weth.address, user1.address);
    await weth.connect(user1).transfer(vault.address, expandDecimals(30, 18));
    console.log("*** MASTER TRANSFERED COLLATERAL TO VAULT ****");
    await vault
      .connect(user1)
      .increasePosition(
        positionToFollow.master,
        positionToFollow.collateral,
        positionToFollow.indexToken,
        positionToFollow.sizeDelta,
        positionToFollow.isLong
      );
    console.log("*** POSITION INCREASE FROM MASTER ****");

    //APPROVES MIRROR CONTRACT TO TRADE ON BEHALF OF PUPPET
    await vault.addRouter(mirrorTrading.address);
    console.log("*** PUPPET ADDS MIRROR CONTRACT AS ROUTER ****");

    await mintCollateral(
      collateralToken,
      weth,
      collateralTokenDecimals,
      wallet
    );
    console.log("*** COLLATERAL FROM PUPPET MINTED ****");

    await collateralToken.approve(
      mirrorTrading.address,
      collateralToken.balanceOf(wallet.address)
    );
    console.log(
      "*** COLLATERAL TOKEN APPROVED FROM PUPPET TO MIRROR CONTRACT ****"
    );

    //CALL TO SET A MIRROR TRADE - INCRASE POSITION TO MIMIC MASTER - DATA WILL COME FROM THE KEEPER
    let position1 = mirrorTrading.increasePosition(
      vault.address,
      positionToFollow.master, //master account
      positionToFollow.collateral, // collateral token
      positionToFollow.indexToken, // index token
      positionToFollow.isLong, //isLong
      wallet.address,
      vault.address,
      { gasPrice: "100000000000" }
    );

    await expect(position1).to.be.revertedWith(
      "Mirror: Not following this master"
    );

    await expect(mirrorTrading.followTrader(positionToFollow.master)).to.emit(
      mirrorTrading,
      "FollowingTrader"
    );

    //CALL TO SET A MIRROR TRADE - INCRASE POSITION TO MIMIC MASTER - DATA WILL COME FROM THE KEEPER
    await mirrorTrading.increasePosition(
      vault.address,
      positionToFollow.master, //master account
      positionToFollow.collateral, // collateral token
      positionToFollow.indexToken, // index token
      positionToFollow.isLong, //isLong
      wallet.address,
      vault.address,
      { gasPrice: "100000000000" }
    );

    let positionOpened = await vault.getPosition(
      wallet.address,
      collateralToken.address,
      indexToken.address,
      isLong
    );

    console.log("***********************************************");
    console.log("** FROM FRONTEND PUPPET INCREASE POSITION    **");
    console.log(
      "PUPPET OPENED POSITION SIZE USD=> ",
      convertToNormalNumber(positionOpened[0], 30)
    );
    console.log(
      "PUPPET OPENED POSITION COLLATERAL USD=> ",
      convertToNormalNumber(positionOpened[1], 30)
    );
    console.log(
      "PUPPET OPENED POSITION LEVERAGE=> ",
      convertToNormalNumber(positionOpened[0], 30) /
        convertToNormalNumber(positionOpened[1], 30)
    );
    console.log(
      "PUPPET OPENED POSITION AVG.PRICE USD=> ",
      convertToNormalNumber(positionOpened[2], 30)
    );
    console.log(
      "PUPPET ENTRY FUNDING RATE AVG.PRICE USD=> ",
      convertToNormalNumber(positionOpened[3], 30)
    );
    console.log(
      "PUPPET RESERVE AMOUNT => ",
      convertToNormalNumber(positionOpened[4], 30)
    );
    console.log(
      "RPUPPET EALIZED PnL => ",
      convertToNormalNumber(positionOpened[5], 30)
    );
    console.log("PUPPET PnL POSITIVE => ", positionOpened[6]);
    console.log("PUPPET TIME => ", positionOpened[5].toNumber());
    console.log("***********************************************");
  });

  it("DecreasePosition", async () => {
    await wethPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    await vault.setMaxGasPrice("1000000000000");
    await vault.setTokenConfig(...getEthConfig(weth, wethPriceFeed));
    await vault.setIsLeverageEnabled(true);

    console.log("*** VAULT IS INITIATED DECREASE POSITION ****");

    let positionToFollow = {
      master: user1.address,
      collateral: weth.address,
      indexToken: weth.address,
      sizeDelta: toUsd(50),
      isLong: true,
    };

    await weth.mint(user1.address, expandDecimals(5000, 18));
    console.log("*** MINTED COLLATERAL FOR MASTER ****");
    await weth.connect(user1).transfer(vault.address, expandDecimals(1000, 18));
    await vault.buyUSDG(weth.address, user1.address);
    await weth.connect(user1).transfer(vault.address, expandDecimals(30, 18));
    console.log("*** MASTER TRANSFERED COLLATERAL TO VAULT ****");
    await vault
      .connect(user1)
      .increasePosition(
        positionToFollow.master,
        positionToFollow.collateral,
        positionToFollow.indexToken,
        positionToFollow.sizeDelta,
        positionToFollow.isLong
      );
    console.log("*** POSITION INCREASE FROM MASTER ****");

    //APPROVES MIRROR CONTRACT TO TRADE ON BEHALF OF PUPPET
    await vault.addRouter(mirrorTrading.address);
    console.log("*** PUPPET ADDS MIRROR CONTRACT AS ROUTER ****");

    await mintCollateral(
      collateralToken,
      weth,
      collateralTokenDecimals,
      wallet
    );
    console.log("*** COLLATERAL FROM PUPPET MINTED ****");

    await collateralToken.approve(
      mirrorTrading.address,
      collateralToken.balanceOf(wallet.address)
    );
    console.log(
      "*** COLLATERAL TOKEN APPROVED FROM PUPPET TO MIRROR CONTRACT ****"
    );

    //CALL TO SET A MIRROR TRADE - INCRASE POSITION TO MIMIC MASTER - DATA WILL COME FROM THE KEEPER
    let position1 = mirrorTrading.increasePosition(
      vault.address,
      positionToFollow.master, //master account
      positionToFollow.collateral, // collateral token
      positionToFollow.indexToken, // index token
      positionToFollow.isLong, //isLong
      wallet.address,
      vault.address,
      { gasPrice: "100000000000" }
    );

    await expect(position1).to.be.revertedWith(
      "Mirror: Not following this master"
    );

    await expect(mirrorTrading.followTrader(positionToFollow.master)).to.emit(
      mirrorTrading,
      "FollowingTrader"
    );

    //CALL TO SET A MIRROR TRADE - INCRASE POSITION TO MIMIC MASTER - DATA WILL COME FROM THE KEEPER
    await mirrorTrading.increasePosition(
      vault.address,
      positionToFollow.master, //master account
      positionToFollow.collateral, // collateral token
      positionToFollow.indexToken, // index token
      positionToFollow.isLong, //isLong
      wallet.address,
      vault.address,
      { gasPrice: "100000000000" }
    );

    let positionOpened = await vault.getPosition(
      wallet.address,
      collateralToken.address,
      indexToken.address,
      isLong
    );

    console.log("***********************************************");
    console.log("** FROM FRONTEND PUPPET INCREASE POSITION    **");
    console.log(
      "PUPPET OPENED POSITION SIZE USD=> ",
      convertToNormalNumber(positionOpened[0], 30)
    );
    console.log(
      "PUPPET OPENED POSITION COLLATERAL USD=> ",
      convertToNormalNumber(positionOpened[1], 30)
    );
    console.log(
      "PUPPET OPENED POSITION LEVERAGE=> ",
      convertToNormalNumber(positionOpened[0], 30) /
        convertToNormalNumber(positionOpened[1], 30)
    );
    console.log(
      "PUPPET OPENED POSITION AVG.PRICE USD=> ",
      convertToNormalNumber(positionOpened[2], 30)
    );
    console.log(
      "PUPPET ENTRY FUNDING RATE AVG.PRICE USD=> ",
      convertToNormalNumber(positionOpened[3], 30)
    );
    console.log(
      "PUPPET RESERVE AMOUNT => ",
      convertToNormalNumber(positionOpened[4], 30)
    );
    console.log(
      "RPUPPET EALIZED PnL => ",
      convertToNormalNumber(positionOpened[5], 30)
    );
    console.log("PUPPET PnL POSITIVE => ", positionOpened[6]);
    console.log("PUPPET TIME => ", positionOpened[5].toNumber());
    console.log("***********************************************");

    let collateralDelta = 0;
    let sizeDelta = toUsd(50);
    await vault
      .connect(user1)
      .decreasePosition(
        positionToFollow.master,
        positionToFollow.collateral,
        positionToFollow.indexToken,
        collateralDelta,
        sizeDelta,
        positionToFollow.isLong,
        positionToFollow.master
      );
    console.log("*** POSITION DECREASE FROM MASTER ****");

    await mirrorTrading.decreasePosition(
      vault.address,
      positionToFollow.master, //master account
      positionToFollow.collateral, // collateral token
      positionToFollow.indexToken, // index token
      positionToFollow.isLong, //isLong
      wallet.address,
      vault.address,
      { gasPrice: "100000000000" }
    );

    let positionDecreased = await vault
      .connect(wallet)
      .getPosition(
        wallet.address,
        positionToFollow.collateral,
        positionToFollow.indexToken,
        positionToFollow.isLong
      );

    console.log("**************DECREASE POSITION****************");
    console.log("** FROM FRONTEND PUPPET DECREASE POSITION    **");
    console.log(
      "PUPPET OPENED POSITION SIZE USD=> ",
      convertToNormalNumber(positionDecreased[0], 30)
    );
    console.log(
      "PUPPET OPENED POSITION COLLATERAL USD=> ",
      convertToNormalNumber(positionDecreased[1], 30)
    );
    console.log(
      "PUPPET OPENED POSITION LEVERAGE=> ",
      convertToNormalNumber(positionDecreased[0], 30) /
        convertToNormalNumber(positionDecreased[1], 30)
    );
    console.log(
      "PUPPET OPENED POSITION AVG.PRICE USD=> ",
      convertToNormalNumber(positionDecreased[2], 30)
    );
    console.log(
      "PUPPET ENTRY FUNDING RATE AVG.PRICE USD=> ",
      convertToNormalNumber(positionDecreased[3], 30)
    );
    console.log(
      "PUPPET RESERVE AMOUNT => ",
      convertToNormalNumber(positionDecreased[4], 30)
    );
    console.log(
      "RPUPPET EALIZED PnL => ",
      convertToNormalNumber(positionDecreased[5], 30)
    );
    console.log("PUPPET PnL POSITIVE => ", positionDecreased[6]);
    console.log("PUPPET TIME => ", positionDecreased[5].toNumber());
    console.log("***********************************************");
  });
});
