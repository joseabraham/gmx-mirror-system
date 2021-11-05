const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract, contractAt } = require("../shared/fixtures")
const {swapETHForExactTokens} = require("../shared/UniswapV2Router");
const { bigNumberify, expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, newWallet } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")
// const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("./Vault/helpers")

use(solidity)

describe("MirrorTrading", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let mirrorTrading
  let reader
  let vault
  let router
  let collateralToken
//   let usdg
//   let router
//   let vaultPriceFeed
//   let bnb
//   let bnbPriceFeed
//   let btc
//   let btcPriceFeed
//   let eth
//   let ethPriceFeed
//   let dai
//   let daiPriceFeed
//   let busd
//   let busdPriceFeed
//   let distributor0
//   let yieldTracker0
//   let reader

  beforeEach(async () => {
    reader = await deployContract("Reader", [], "Reader")
    mirrorTrading = await deployContract("MirrorTrading", [reader.address])
    vault = await contractAt("Vault", "0x489ee077994B6658eAfA855C308275EAd8097C4A")
    router = await contractAt("Router", "0xaBBc5F99639c9B6bCb58544ddf04EFA6802F4064")    
    collateralToken = await contractAt("Token", "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8")
    // btc = await deployContract("Token", [])
    // btcPriceFeed = await deployContract("PriceFeed", [])

    // eth = await deployContract("Token", [])
    // ethPriceFeed = await deployContract("PriceFeed", [])

    // dai = await deployContract("Token", [])
    // daiPriceFeed = await deployContract("PriceFeed", [])

    // busd = await deployContract("Token", [])
    // busdPriceFeed = await deployContract("PriceFeed", [])

    // vault = await deployContract("Vault", [])
    // usdg = await deployContract("USDG", [vault.address])
    // router = await deployContract("Router", [vault.address, usdg.address, bnb.address])
    // vaultPriceFeed = await deployContract("VaultPriceFeed", [])

    // await initVault(vault, router, usdg, vaultPriceFeed)

    // distributor0 = await deployContract("TimeDistributor", [])
    // yieldTracker0 = await deployContract("YieldTracker", [usdg.address])

    // await yieldTracker0.setDistributor(distributor0.address)
    // await distributor0.setDistribution([yieldTracker0.address], [1000], [bnb.address])

    // await bnb.mint(distributor0.address, 5000)
    // await usdg.setYieldTrackers([yieldTracker0.address])

    // reader = await deployContract("Reader", [])

    // await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
    // await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
    // await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
    // await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)

    // await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    // await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    // await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
    // await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    // await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    // await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    // await bnb.connect(user3).deposit({ value: expandDecimals(100, 18) })
  })

  it("followTrader", async () => {    
    //starts following and checks follow event
    await expect(mirrorTrading.followTrader(user1.address))
    .to.emit(mirrorTrading, 'FollowingTrader')   
    let puppetIsCreated = await mirrorTrading.puppetExists(wallet.address); 
    await expect(puppetIsCreated).eq(true);
    //checks that only allows to follow once a master
    await expect(mirrorTrading.followTrader(user1.address))
      .to.be.revertedWith("Mirror: Already Following this master")    
    let allPuppets = await mirrorTrading.getPuppets();    
    await expect(allPuppets.length).eq(1);
  })

  it("getPuppet", async () => {
    await expect(mirrorTrading.followTrader(user1.address))
    .to.emit(mirrorTrading, 'FollowingTrader')
    let gettingPuppet = await mirrorTrading.getPuppet(wallet.address);    
    await expect(gettingPuppet).to.be.above(0)
  })

  it("getAllFollows", async () => {
    await expect(mirrorTrading.followTrader(user1.address))
    .to.emit(mirrorTrading, 'FollowingTrader')
    await mirrorTrading.followTrader(user2.address)    
    let allFollows = await mirrorTrading.getAllFollows();        
    await expect(allFollows.length).eq(2)
  })

  it("unFollow", async () => {    
    await expect(mirrorTrading.followTrader(user1.address))
    .to.emit(mirrorTrading, 'FollowingTrader')        
    await mirrorTrading.unFollow(user1.address);
    let getFollowing = await mirrorTrading.getIfFollowing(user1.address);
    await expect(getFollowing).eq(false);    
  })

  it("vault-data", async (done)=>{      
    this.timeout(50000)
    
    //   let testVault = await vault.getMinPrice("0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8")
    //   console.log("testVault", testVault)
      //GETS THIS DATA FROM API - https://api.gmx.io/actions
    //   let vaultPosition = await vault.getPosition(
    //       "0xc23203e8aD67fB13388Bf58D513fb42B490C9DC3", //master account
    //       "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", // collateral token
    //       "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // index token
    //       false //isLong
    //   )

    //ADDS PUPPET TO FOLLOW A MASTER
    await expect(mirrorTrading.followTrader(user1.address))
    .to.emit(mirrorTrading, 'FollowingTrader')   

    //APPROVES MIRROR CONTRACT TO TRADE ON BEHALF OF PUPPET
    await vault.addRouter(mirrorTrading.address);

    console.log('balanceOfCollateral', (await collateralToken.balanceOf(wallet.address)).toNumber())  

    // Swap ETH for USC
    await swapETHForExactTokens(
      expandDecimals("10", 18),
      expandDecimals("1000", 6),
      collateralToken.address,
      wallet.address,
      wallet,
    );

    console.log('balanceOfCollateral', (await collateralToken.balanceOf(wallet.address)).toNumber())  
  
    
    //TRANSFER COLLATERAL TO VAULT    
    await collateralToken.connect(wallet).transfer(vault.address, 1000)    
    
    //CALL TO SET A MIRROR TRADE - INCRASE POSITION TO MIMIC MASTER
    let mirrorTrade = await mirrorTrading.setMirrorTradeIncreasePosition(
        router.address, 
        vault.address, 
        "0xc23203e8aD67fB13388Bf58D513fb42B490C9DC3", //master account
        "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", // collateral token
        "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // index token
        false,
        wallet.address,
        { gasPrice: "100000000000" }
        )    
    console.log("mirrorTrade", mirrorTrade)

    let vaultPositionMirror = await vault.getPosition(
        wallet.address, //master account
        "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", // collateral token
        "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // index token
        false //isLong        
    )

    console.log("vaultPositionMirror", vaultPositionMirror)
    done();
    //   let vaultData = {
    //       positionUSD: vaultPosition[0].toString()
    //   }
    // //   console.log("vaultPosition", vaultPosition)
    // //   console.log("vaultData", vaultData)


    //   vaultPosition [
    //     BigNumber { // POSITION IN USD
    //       _hex: '0x81eed39f7637714e38878a000000',
    //       _isBigNumber: true
    //     },
    //     BigNumber { // COLLATERAL IN USD
    //       _hex: '0x04496a04b1c25546bc5e17c00000',
    //       _isBigNumber: true
    //     },
    //     BigNumber { // AVERAGE PRICE
    //       _hex: '0xdd7a45eda642b930c225a0000000',
    //       _isBigNumber: true
    //     },
    //     BigNumber { _hex: '0x87b2', _isBigNumber: true }, //entryFundingRate
    //     BigNumber { _hex: '0x9d144a3b', _isBigNumber: true }, // RESERVE AMOUNT
    //     BigNumber { _hex: '0x00', _isBigNumber: true }, //realisedPnl
    //     true, // HAS PROFIT
    //     BigNumber { _hex: '0x61847e2a', _isBigNumber: true } //LAST INCRASED TIME
    //   ]
      
  })




})
