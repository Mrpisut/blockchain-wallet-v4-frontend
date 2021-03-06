import {
  cancel,
  call,
  delay,
  fork,
  put,
  select,
  spawn,
  take
} from 'redux-saga/effects'
import moment from 'moment'
import {
  compose,
  difference,
  equals,
  keys,
  lift,
  prop,
  sortBy,
  tail
} from 'ramda'

import { Remote } from 'blockchain-wallet-v4'
import { selectors, actions, actionTypes } from 'data'
import * as A from './actions'
import * as S from './selectors'
import { KYC_STATES, USER_ACTIVATION_STATES } from './model'

export const logLocation = 'modules/profile/sagas'
export const userRequiresRestoreError = 'User restored'
export const authRetryDelay = 5000
export const renewUserDelay = 30000

let renewSessionTask = null
let renewUserTask = null
export default ({ api, coreSagas, networks }) => {
  const getCampaignData = function * (campaign) {
    if (campaign.name === 'sunriver') {
      const xlmAccount = (yield select(
        selectors.core.kvStore.xlm.getDefaultAccountId
      )).getOrFail()
      return {
        'x-campaign-address': xlmAccount,
        'x-campaign-code': campaign.code,
        'x-campaign-email': campaign.email
      }
    }

    return null
  }

  const signIn = function * () {
    try {
      const email = (yield select(selectors.core.settings.getEmail)).getOrFail(
        'No email'
      )
      const guid = yield select(selectors.core.wallet.getGuid)

      yield call(coreSagas.kvStore.userCredentials.fetchMetadataUserCredentials)
      const userId = (yield select(
        selectors.core.kvStore.userCredentials.getUserId
      )).getOrElse(null)
      const lifetimeToken = (yield select(
        selectors.core.kvStore.userCredentials.getLifetimeToken
      )).getOrElse(null)
      if (!userId || !lifetimeToken) {
        return yield put(
          A.fetchUserDataSuccess({
            state: USER_ACTIVATION_STATES.NONE,
            kycState: KYC_STATES.NONE
          })
        )
      }

      yield put(A.setApiTokenLoading())
      renewSessionTask = yield fork(
        renewSession,
        userId,
        lifetimeToken,
        email,
        guid,
        0
      )
    } catch (e) {
      yield put(actions.logs.logErrorMessage(logLocation, 'signIn', e))
    }
  }

  const renewSession = function * (
    userId,
    lifetimeToken,
    email,
    guid,
    renewIn = 0
  ) {
    try {
      yield delay(renewIn)
      yield call(setSession, userId, lifetimeToken, email, guid)
    } catch (e) {
      yield put(A.setApiTokenFailure(e))
      yield spawn(
        renewSession,
        userId,
        lifetimeToken,
        email,
        guid,
        authRetryDelay
      )
    }
  }

  const setSession = function * (userId, lifetimeToken, email, guid) {
    try {
      const { token: apiToken, expiresAt } = yield call(
        api.generateSession,
        userId,
        lifetimeToken,
        email,
        guid
      )
      yield put(A.setApiTokenSuccess(apiToken))
      yield call(fetchUser)
      yield call(renewApiSockets)
      const expiresIn = moment(expiresAt)
        .subtract(5, 's')
        .diff(moment())
      yield spawn(renewSession, userId, lifetimeToken, email, guid, expiresIn)
    } catch (e) {
      if (prop('description', e) === userRequiresRestoreError) {
        return yield call(recoverUser)
      }
      throw e
    }
  }

  const fetchUser = function * () {
    try {
      const user = yield call(api.getUser)
      yield put(A.fetchUserDataSuccess(user))
      yield call(fetchTiers)
      if (!renewUserTask && user.kycState === KYC_STATES.PENDING)
        renewUserTask = yield spawn(renewUser, renewUserDelay)

      return user
    } catch (e) {
      if (prop('description', e) === userRequiresRestoreError) throw e
      yield put(A.fetchUserDataFailure(e))
      yield put(actions.logs.logErrorMessage(logLocation, 'fetchUser', e))
    }
  }

  const renewUser = function * (renewIn = 0) {
    try {
      yield delay(renewIn)
      const user = yield call(api.getUser)
      yield put(A.fetchUserDataSuccess(user))
    } catch (e) {
      yield put(actions.logs.logErrorMessage(logLocation, 'renewUser', e))
    } finally {
      yield spawn(renewUser, renewUserDelay)
    }
  }

  const renewApiSockets = function * () {
    yield put(actions.middleware.webSocket.rates.stopSocket())
    yield put(actions.middleware.webSocket.rates.startSocket())
  }

  const clearSession = function * () {
    if (renewSessionTask) {
      yield cancel(renewSessionTask)
      renewSessionTask = null
    }
    if (renewUserTask) {
      yield cancel(renewUserTask)
      renewUserTask = null
    }

    yield put(A.setApiTokenNotAsked())
  }

  const generateRetailToken = function * () {
    const guid = yield select(selectors.core.wallet.getGuid)
    const sharedKey = yield select(selectors.core.wallet.getSharedKey)
    const { token } = yield call(api.generateRetailToken, guid, sharedKey)
    return token
  }

  const generateAuthCredentials = function * () {
    const retailToken = yield call(generateRetailToken)
    const coinifyId = (yield select(
      selectors.core.kvStore.buySell.getCoinifyUser
    )).getOrElse(null)
    const { userId, token: lifetimeToken } = yield call(
      api.createUser,
      retailToken,
      coinifyId
    )
    yield put(
      actions.core.kvStore.userCredentials.setUserCredentials(
        userId,
        lifetimeToken
      )
    )
    return { userId, lifetimeToken }
  }

  const recoverUser = function * () {
    const retailToken = yield call(generateRetailToken)
    const userId = (yield select(
      selectors.core.kvStore.userCredentials.getUserId
    )).getOrFail()
    const lifetimeToken = (yield select(
      selectors.core.kvStore.userCredentials.getLifetimeToken
    )).getOrFail()
    yield call(api.recoverUser, userId, lifetimeToken, retailToken)
    const email = (yield select(selectors.core.settings.getEmail)).getOrFail()
    const guid = yield select(selectors.core.wallet.getGuid)
    yield call(setSession, userId, lifetimeToken, email, guid)
  }

  const createUser = function * () {
    const token = yield select(S.getApiToken)
    if (!Remote.NotAsked.is(token)) return

    const userIdR = yield select(
      selectors.core.kvStore.userCredentials.getUserId
    )
    const lifetimeTokenR = yield select(
      selectors.core.kvStore.userCredentials.getLifetimeToken
    )
    const authCredentialsR = lift((userId, lifetimeToken) => ({
      userId,
      lifetimeToken
    }))(userIdR, lifetimeTokenR)
    const email = (yield select(selectors.core.settings.getEmail)).getOrFail()
    const guid = yield select(selectors.core.wallet.getGuid)

    const { userId, lifetimeToken } = yield authCredentialsR
      .map(authCredentials => {
        const { userId, lifetimeToken } = authCredentials
        if (!userId || !lifetimeToken) return call(generateAuthCredentials)
        return authCredentials
      })
      .getOrElse({})

    yield call(setSession, userId, lifetimeToken, email, guid)
  }

  const updateUser = function * ({ payload }) {
    const { data } = payload
    const user = (yield select(S.getUserData)).getOrElse({})
    const {
      id,
      address,
      mobile,
      mobileVerified,
      state,
      kycState,
      ...userData
    } = user
    const updatedData = { ...userData, ...data }

    if (equals(updatedData, userData)) return user

    yield call(api.updateUser, updatedData)
    return yield call(fetchUser)
  }

  const updateUserAddress = function * ({ payload }) {
    const { address } = payload
    const user = (yield select(S.getUserData)).getOrElse({})
    const { address: prevAddress } = user

    if (equals(address, prevAddress)) return user

    yield call(api.updateUserAddress, address)
    return yield call(fetchUser)
  }

  const syncUserWithWallet = function * () {
    const retailToken = yield call(generateRetailToken)
    const userData = yield call(api.syncUserWithWallet, retailToken)
    yield put(A.fetchUserDataSuccess(userData))
  }

  const fetchTiers = function * () {
    try {
      const tiers = yield select(S.getTiers)
      if (!Remote.Success.is(tiers)) yield put(A.fetchTiersLoading())
      const tiersData = yield call(api.fetchTiers)
      yield put(
        A.fetchTiersSuccess(
          compose(
            tail,
            sortBy(prop('index'))
          )(tiersData.tiers)
        )
      )
    } catch (e) {
      yield put(A.fetchTiersFailure(e))
    }
  }

  const shareAddresses = function * () {
    try {
      yield put(A.shareAddressesLoading())
      // TODO: move to goal and pass remaining coins to saga
      // Only run saga if remainingCoins is !empty
      const supportedCoinsList = (yield select(
        selectors.core.walletOptions.getSupportedCoinsList
      )).getOrFail('no_supported_coins')
      const depositAddresses = (yield select(S.getDepositAddresses)).getOrFail(
        'no_deposit_addresses'
      )
      const depositAddressesList = keys(depositAddresses)
      const remainingCoins = difference(
        supportedCoinsList,
        depositAddressesList
      )

      // BTC
      const defaultIdx = yield select(
        selectors.core.wallet.getDefaultAccountIndex
      )
      const BTC = selectors.core.common.btc.getNextAvailableReceiveAddress(
        networks.btc,
        defaultIdx
      )
      // BCH
      const BCH = selectors.core.common.bch.getNextAvailableReceiveAddress(
        networks.btc,
        defaultIdx
      )
      // ETH
      const ETH = selectors.core.kvStore.eth.getContext
      // XLM
      const XLM = selectors.core.kvStore.xlm.getDefaultAccountId

      const addressSelectors = { BTC, BCH, ETH, XLM, PAX: ETH }

      const state = yield select()
      const remainingAddresses = remainingCoins.reduce((res, coin) => {
        res[coin] = addressSelectors[coin](state).getOrElse(null)
        return res
      }, depositAddresses)
      const data = yield call(api.shareDepositAddresses, remainingAddresses)
      yield put(A.shareAddressesSuccess(data))
    } catch (e) {
      yield put(A.shareAddressesFailure(e))
    }
  }

  const linkAccount = function * ({ payload }) {
    try {
      const { linkId } = payload
      yield put(A.linkAccountLoading())
      // Check if email is verified
      const isEmailVerified = (yield select(
        selectors.core.settings.getEmailVerified
      )).getOrElse(true)
      // If email is not verified wait
      if (!isEmailVerified)
        yield take(actionTypes.core.settings.SET_EMAIL_VERIFIED)
      // Check if user is created
      const isUserStateNone = (yield select(S.isUserStateNone)).getOrElse(false)
      // If user is not created, create
      if (isUserStateNone) yield call(createUser)
      // Link Account
      const data = yield call(api.linkAccount, linkId)
      yield put(A.shareAddresses())
      yield put(A.linkAccountSuccess(data))
    } catch (e) {
      yield put(A.linkAccountFailure(e))
    }
  }

  const createLinkAccountId = function * () {
    try {
      yield put(A.createLinkAccountIdLoading())
      const thePitBaseUrl = (yield select(
        selectors.core.walletOptions.getThePitDomain
      )).getOrFail('no_pit_url')
      const email = (yield select(selectors.core.settings.getEmail)).getOrFail(
        'no_email'
      )
      const data = yield call(api.createLinkAccountId)
      const emailEncoded = encodeURIComponent(email)
      window.open(
        `${thePitBaseUrl}/trade/link/${data.linkId}?email=${emailEncoded}`,
        '_blank',
        'noreferrer'
      )
      yield put(A.createLinkAccountIdSuccess(data))
    } catch (e) {
      const error = typeof e === 'string' ? e : e.message
      yield put(A.createLinkAccountIdFailure(e))
      yield put(actions.alerts.displayError(error))
    }
  }

  return {
    clearSession,
    createUser,
    createLinkAccountId,
    fetchTiers,
    fetchUser,
    generateAuthCredentials,
    generateRetailToken,
    getCampaignData,
    linkAccount,
    recoverUser,
    renewApiSockets,
    renewSession,
    renewUser,
    setSession,
    shareAddresses,
    signIn,
    syncUserWithWallet,
    updateUser,
    updateUserAddress
  }
}
