/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
#include <algorithm>

#include "mozilla/Assertions.h"

// nICEr includes
#include "local_addr.h"
#include "transport_addr.h"

// Local includes
#include "nricestunaddr.h"

template <typename T, size_t N>
static void StringToArray(const nsTSubstring<T>& str, T (&array)[N]) {
  const auto copied = str.View().copy(array, N - 1);
  array[copied] = '\0';
}

namespace mozilla {

NrIceStunAddr::NrIceStunAddr(const nr_local_addr* addr)
    : protocol_(protocolFromNrTransportAddr(addr->addr)),
      address_(addressFromNrTransportAddr(addr->addr)),
      ifname_(addr->addr.ifname),
      fqdn_(addr->addr.fqdn),
      is_proxied_(addr->addr.is_proxied),
      tls_(addr->addr.tls),
      interface_type_(static_cast<InterfaceType>(addr->iface.type)),
      estimated_speed_(addr->iface.estimated_speed),
      temporary_((addr->flags & NR_ADDR_FLAG_TEMPORARY) != 0) {}

NrIceStunAddr::Protocol NrIceStunAddr::protocolFromNrTransportAddr(
    const nr_transport_addr& addr) {
  switch (addr.protocol) {
    case 0:
      return Protocol::None;
    case IPPROTO_TCP:
      return Protocol::TCP;
    case IPPROTO_UDP:
      return Protocol::UDP;
    default:
      MOZ_CRASH("invalid protocol");
  }
}

decltype(NrIceStunAddr::address_) NrIceStunAddr::addressFromNrTransportAddr(
    const nr_transport_addr& addr) {
  switch (addr.ip_version) {
    case NR_IPV4:
      return AsVariant(
          IPv4{addr.u.addr4.sin_addr.s_addr, addr.u.addr4.sin_port});
    case NR_IPV6:
      return AsVariant(IPv6{std::to_array(addr.u.addr6.sin6_addr.s6_addr),
                            addr.u.addr6.sin6_port, addr.u.addr6.sin6_flowinfo,
                            addr.u.addr6.sin6_scope_id});
    default:
      MOZ_CRASH("invalid IP version");
  }
}

NrIceStunAddr::NrIceStunAddr(const NrIceStunAddr& rhs) = default;

NrIceStunAddr::~NrIceStunAddr() = default;

void NrIceStunAddr::toNrLocalAddr(nr_local_addr& addr) const {
  memset(&addr, 0, sizeof(nr_local_addr));
  switch (protocol_) {
    case Protocol::None:
      break;
    case Protocol::TCP:
      addr.addr.protocol = IPPROTO_TCP;
      break;
    case Protocol::UDP:
      addr.addr.protocol = IPPROTO_UDP;
      break;
  }
  address_.match(
      [&](const IPv4& v4) {
        addr.addr.ip_version = NR_IPV4;
        auto& sockaddr = addr.addr.u.addr4;
        sockaddr.sin_family = AF_INET;
        sockaddr.sin_addr.s_addr = v4.address;
        sockaddr.sin_port = v4.port;
      },
      [&](const IPv6& v6) {
        addr.addr.ip_version = NR_IPV6;
        auto& sockaddr = addr.addr.u.addr6;
        sockaddr.sin6_family = AF_INET6;
        std::copy(v6.address.begin(), v6.address.end(),
                  sockaddr.sin6_addr.s6_addr);
        sockaddr.sin6_port = v6.port;
        sockaddr.sin6_flowinfo = v6.flowinfo;
        sockaddr.sin6_scope_id = v6.scope_id;
      });
  StringToArray(ifname_, addr.addr.ifname);
  StringToArray(fqdn_, addr.addr.fqdn);
  addr.addr.is_proxied = is_proxied_;
  addr.addr.tls = tls_;
  // generate as_string
  nr_transport_addr_fmt_addr_string(&addr.addr);

  addr.iface.type = static_cast<int>(interface_type_);
  addr.iface.estimated_speed = estimated_speed_;

  if (temporary_) {
    addr.flags |= NR_ADDR_FLAG_TEMPORARY;
  }
}

}  // namespace mozilla
