import React from 'react'
import { FormattedMessage } from 'react-intl'

const description = (
  <div className='d-flex flex-column justify-item-start'>
    <div className='h6'>
      <FormattedMessage id='scenes.settings.passwordstretching.title' defaultMessage='Password stretching (PBKDF2)' />
    </div>
    <div>
      <FormattedMessage id='scenes.settings.passwordstretching.description' defaultMessage='This increases the difficulty of discovering your password using a brute-force attack but slows down loading and saving your wallet.' />
    </div>
  </div>
)

const settings = (
  <div className='d-flex flex-column justify-item-start align-items-end'>
    <button className='button-secondary'>
      <FormattedMessage id='scenes.settings.passwordstretching.change' defaultMessage='Change' />
    </button>
  </div>
)

export default {
  description, settings
}
