import Websock from '@/utils/webclient/websock'
import * as rendezvous from '@/utils/webclient/rendezvous'
import * as message from '@/utils/webclient/message'
import { ElMessageBox } from 'element-plus'
import { T } from '@/utils/i18n'
import { useAppStore } from '@/store/app'



const app = useAppStore()

export const toWebClientLink = (row) => {
  // webclient2 was removed upstream; the v1 web client prefills the ID from #/<id>
  window.open(`${app.setting.rustdeskConfig.api_server}/webclient/#/${encodeURIComponent(row.id)}`)
}

// WebSocket URL for hbbs (id) or hbbr (relay). On https pages the raw 21118/21119 ports
// only speak plain WebSocket, so go through the reverse proxy's /ws/id and /ws/relay paths.
const wsUrl = (server, relay) => {
  const [addr, port] = (server || '').split(':')
  if (location.protocol === 'https:') {
    return `wss://${addr}/ws/${relay ? 'relay' : 'id'}`
  }
  const base = parseInt(port) || (relay ? 21117 : 21116)
  return `ws://${addr}:${base + 2}`
}

export async function getPeerSlat (id) {
  const idServer = app.setting.rustdeskConfig.id_server
  if (!idServer || !idServer.split(':')[0]) {
    return
  }
  const ws = new Websock(wsUrl(idServer, false), true)
  await ws.open()
  const conn_type = rendezvous.ConnType.DEFAULT_CONN
  const nat_type = rendezvous.NatType.SYMMETRIC
  const punch_hole_request = rendezvous.PunchHoleRequest.fromPartial({
    id,
    licence_key: app.setting.rustdeskConfig.key || undefined,
    conn_type,
    nat_type,
    token: undefined,
  })
  ws.sendRendezvous({ punch_hole_request })
  //rendezvous.RendezvousMessage
  const msg = (await ws.next())
  ws.close()
  console.log(new Date() + ': Got relay response', msg)
  const phr = msg.punch_hole_response
  const rr = msg.relay_response
  if (phr) {
    if (phr?.other_failure) {
      ElMessageBox.alert(phr.other_failure, T('Error'))
      return false
    }
    if (phr.failure != rendezvous.PunchHoleResponse_Failure.UNRECOGNIZED) {
      switch (phr?.failure) {
        case rendezvous.PunchHoleResponse_Failure.ID_NOT_EXIST:
          ElMessageBox.alert(T('IDNotExist'), T('Error'))
          break
        case rendezvous.PunchHoleResponse_Failure.OFFLINE:
          ElMessageBox.alert(T('RemoteDesktopOffline'), T('Error'))
          break
        case rendezvous.PunchHoleResponse_Failure.LICENSE_MISMATCH:
          ElMessageBox.alert(T('KeyMismatch'), T('Error'))
          break
        case rendezvous.PunchHoleResponse_Failure.LICENSE_OVERUSE:
          ElMessageBox.alert(T('KeyOveruse'), T('Error'))
          break
      }
    }
    return false
  } else if (rr) {
    const uuid = rr.uuid
    console.log(new Date() + ': Connecting to relay server')

    const _ws = new Websock(wsUrl(rr.relay_server || app.setting.rustdeskConfig.relay_server || idServer, true), false)
    await _ws.open()
    console.log(new Date() + ': Connected to relay server')
    const request_relay = rendezvous.RequestRelay.fromPartial({
      licence_key: app.setting.rustdeskConfig.key || undefined,
      uuid,
    })
    _ws.sendRendezvous({ request_relay })

    // public key not supported yet
    const public_key = message.PublicKey.fromPartial({})
    _ws?.sendMessage({ public_key })
    // const secure = (await this.secure(pk)) || false;
    // globals.pushEvent("connection_ready", { secure, direct: false });
    while (true) {
      const msg = (await _ws?.next())
      console.log('msg', msg)
      if (msg?.hash) {
        console.log('hash msg.....', msg.hash)
        _ws.close()
        return msg.hash
      }
    }
    return false
  }

}

export function getV2ShareUrl (token) {
  return `${app.setting.rustdeskConfig.api_server}/webclient2/#/?share_token=${token}`
}
