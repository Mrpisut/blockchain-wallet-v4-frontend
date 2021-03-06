import React from 'react'
import { connect } from 'react-redux'
import { bindActionCreators } from 'redux'
import { actions, selectors } from 'data'
import Template from './template'
import { prop } from 'ramda'

const key = 'wallet'

class WalletBalanceContainer extends React.PureComponent {
  render () {
    const {
      preferencesActions,
      totalBalancesDropdown,
      supportedCoins
    } = this.props
    const isActive = prop(key, totalBalancesDropdown)
    return (
      <Template
        isActive={isActive}
        supportedCoins={supportedCoins}
        handleToggle={() =>
          preferencesActions.setTotalBalancesDropdown({
            key,
            val: !isActive
          })
        }
      />
    )
  }
}

const mapStateToProps = state => ({
  totalBalancesDropdown: selectors.preferences.getTotalBalancesDropdown(state),
  supportedCoins: selectors.core.walletOptions
    .getSupportedCoins(state)
    .getOrFail()
})

const mapDispatchToProps = dispatch => ({
  preferencesActions: bindActionCreators(actions.preferences, dispatch)
})

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(WalletBalanceContainer)
