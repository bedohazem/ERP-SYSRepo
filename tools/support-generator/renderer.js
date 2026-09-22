let privateKeyPath = ''

const $ = (id) => document.getElementById(id)

function setMessage(message, type = 'error') {
  const element = $('message')

  if (!message) {
    element.classList.add('hidden')

    element.textContent = ''

    return
  }

  element.textContent = message

  element.className = `message ${type}`
}

function selectTab(tab) {
  const activation = tab === 'activation'

  $('activationTab').classList.toggle('active', activation)

  $('recoveryTab').classList.toggle('active', !activation)

  $('activationPanel').classList.toggle('hidden', !activation)

  $('recoveryPanel').classList.toggle('hidden', activation)

  setMessage('')
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value)

    setMessage('تم نسخ الكود', 'success')
  } catch {
    setMessage('تعذر نسخ الكود')
  }
}

$('activationTab').addEventListener('click', () => selectTab('activation'))

$('recoveryTab').addEventListener('click', () => selectTab('recovery'))

$('chooseKeyButton').addEventListener('click', async () => {
  try {
    const result = await window.supportApi.choosePrivateKey()

    if (result.canceled) {
      return
    }

    privateKeyPath = result.path

    $('privateKeyLabel').textContent = `جاهز: ${result.name}`

    setMessage('تم تحميل مفتاح التوقيع', 'success')
  } catch (error) {
    setMessage(error?.message || 'تعذر تحميل المفتاح')
  }
})

$('generateActivationButton').addEventListener('click', async () => {
  setMessage('')

  const result = await window.supportApi.generateActivation({
    private_key_path: privateKeyPath,

    device_code: $('activationDevice').value,
  })

  if (!result.success) {
    setMessage(result.message)

    return
  }

  $('activationToken').value = result.token

  $('activationMeta').textContent =
    `License ID: ${result.license_id} | Device: ${result.device_code}`

  $('activationResult').classList.remove('hidden')
})

$('copyActivationButton').addEventListener('click', () => {
  void copyText($('activationToken').value)
})

$('generateRecoveryButton').addEventListener('click', async () => {
  setMessage('')

  const result = await window.supportApi.generateRecovery({
    private_key_path: privateKeyPath,

    device_code: $('recoveryDevice').value,

    request_id: $('recoveryRequest').value,

    username: $('recoveryUsername').value,

    minutes: $('recoveryMinutes').value,
  })

  if (!result.success) {
    setMessage(result.message)

    return
  }

  $('recoveryToken').value = result.token

  $('recoveryMeta').textContent =
    `User: ${result.username} | Request: ${result.request_id} | Expires: ${new Date(
      result.expires_at,
    ).toLocaleString()}`

  $('recoveryResult').classList.remove('hidden')
})

$('copyRecoveryButton').addEventListener('click', () => {
  void copyText($('recoveryToken').value)
})
