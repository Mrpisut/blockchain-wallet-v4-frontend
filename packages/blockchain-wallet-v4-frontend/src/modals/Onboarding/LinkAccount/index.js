import React from 'react'
import { compose, bindActionCreators } from 'redux'
import { connect } from 'react-redux'
import modalEnhancer from 'providers/ModalEnhancer'
import LinkAccount from './template.js'
import { actions, selectors } from 'data'

class LinkAccountContainer extends React.PureComponent {
  componentDidMount () {
    const { linkId } = this.props
    this.props.actions.linkAccount(linkId)
  }

  render () {
    return <LinkAccount {...this.props} />
  }
}

const mapStateToProps = state => ({
  email: selectors.core.settings.getEmail(state).getOrElse(false),
  emailVerified: selectors.core.settings
    .getEmailVerified(state)
    .getOrElse(true),
  linkAccountStatus: selectors.modules.profile.getLinkAccountStatus(state),
  userTiers: selectors.modules.profile.getUserTiers(state)
})

const mapDispatchToProps = dispatch => ({
  actions: bindActionCreators(
    { ...actions.components.identityVerification, ...actions.modules.profile },
    dispatch
  )
})

const enhance = compose(
  modalEnhancer('LinkAccount'),
  connect(
    mapStateToProps,
    mapDispatchToProps
  )
)

export default enhance(LinkAccountContainer)
