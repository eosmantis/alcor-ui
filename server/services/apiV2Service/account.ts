import JSBI from 'jsbi'
import { Router } from 'express'
import { cacheSeconds } from 'route-cache'
import { SwapPool, PositionHistory, Position } from '../../models'
import { getRedisPosition, getPoolInstance } from '../swapV2Service/utils'

import { Position as PositionClass } from '../../../assets/libs/swap-sdk/entities/position'

// TODO Account validation
export const account = Router()


async function calcPositionFees(chain, plainPosition) {
  const pool = await getPoolInstance(chain, plainPosition.pool)

  const position = new PositionClass({ ...plainPosition, pool })
  const fees = await position.getFees()

  return {
    feesA: fees.feesA.toFixed(),
    feesB: fees.feesB.toFixed()
  }
}



async function getPositionStats(chain, id, owner, redisPosition) {
  // Will sort "closed" to the end
  const history = await PositionHistory.find({ chain, id, owner }).sort({ time: 1, type: 1 }).lean()

  let total = 0
  let sub = 0
  let liquidity = JSBI.BigInt(0)
  let collectedFees = { tokenA: 0, tokenB: 0, inUSD: 0 }

  //console.log()

  for (const h of history) {
    if (h.type === 'burn') {
      liquidity = JSBI.subtract(liquidity, JSBI.BigInt(h.liquidity))
      sub += h.totalUSDValue
    }

    if (h.type === 'mint') {
      liquidity = JSBI.add(liquidity, JSBI.BigInt(h.liquidity))
      total += h.totalUSDValue
    }

    if (h.type === 'collect') {
      collectedFees.tokenA += h.tokenA
      collectedFees.tokenB += h.tokenB
      collectedFees.inUSD += h.totalUSDValue
      sub += h.totalUSDValue
    }

    if (h.type == 'mint') total += h.totalUSDValue

    // Might be after close
    if (['burn', 'collect'].includes(h.type)) sub += h.totalUSDValue
  }

  const depositedUSDTotal = +(total - sub).toFixed(4)
  let closed = JSBI.equal(liquidity, JSBI.BigInt(0))

  const stats = { depositedUSDTotal, closed, collectedFees, feesToClime: {} }

  if (redisPosition) {
    stats.feesToClime = await calcPositionFees(chain, redisPosition)
  }

  return stats
}


account.get('/:account', async (req, res) => {
  const network: Network = req.app.get('network')

  const { account } = req.params

  res.json({ account, todo: 'some account data' })
})


account.get('/:account/poolsPositionsIn', async (req, res) => {
  const network: Network = req.app.get('network')

  const { account } = req.params

  const pools = await Position.distinct('pool', { chain: network.name, owner: account }).lean()

  res.json(pools)
})

account.get('/:account/positions', async (req, res) => {
  const network: Network = req.app.get('network')
  const redis = req.app.get('redisClient')

  const positions = JSON.parse(await redis.get(`positions_${network.name}`))

  res.json(positions.filter(p => p.owner == req.params.account))
})


account.get('/:account/positions-stats', async (req, res) => {
  const network: Network = req.app.get('network')
  const redis = req.app.get('redisClient')


  const { account } = req.params

  const positions = await PositionHistory.distinct('id', { chain: network.name, owner: account }).lean()

  const fullPositions = []
  for (const id of positions) {
    const redisPosition = await getRedisPosition(network.name, id)

    const stats = await getPositionStats(network.name, id, account, redisPosition)
    fullPositions.push({ id, ...stats })
  }

  res.json(fullPositions)
})
