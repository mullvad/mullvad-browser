/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifdef WIN32

#include "addrs-win32.h"
#include <csi_platform.h>
#include <assert.h>
#include <string.h>
#include "util.h"
#include "stun_util.h"
#include "util.h"
#include <r_macros.h>
#include "nr_crypto.h"

#include <iphlpapi.h>

#define NR_MD5_HASH_LENGTH 16

static int stun_win32_address_disallowed(IP_ADAPTER_UNICAST_ADDRESS *addr)
{
  return (addr->DadState != NldsPreferred) &&
          (addr->DadState != IpDadStatePreferred);
}

static int stun_win32_address_temp_v6(IP_ADAPTER_UNICAST_ADDRESS *addr)
{
  return (addr->Address.lpSockaddr->sa_family == AF_INET6) &&
      (addr->SuffixOrigin == IpSuffixOriginRandom);
}

int
stun_getaddrs_filtered(nr_local_addr addrs[], int maxaddrs, int *count)
{
    int r, _status;
    PIP_ADAPTER_ADDRESSES AdapterAddresses = NULL, tmpAddress = NULL;
    // recomended per https://msdn.microsoft.com/en-us/library/windows/desktop/aa365915(v=vs.85).aspx
    static const ULONG initialBufLen = 15000;
    ULONG buflen = initialBufLen;
    char bin_hashed_ifname[NR_MD5_HASH_LENGTH];
    char hex_hashed_ifname[MAXIFNAME];
    int n = 0;

    *count = 0;

    if (maxaddrs <= 0)
      ABORT(R_BAD_ARGS);

    /* According to MSDN (see above) we have try GetAdapterAddresses() multiple times */
    for (n = 0; n < 5; n++) {
      AdapterAddresses = (PIP_ADAPTER_ADDRESSES) malloc(buflen);
      if (AdapterAddresses == NULL) {
        r_log(NR_LOG_STUN, LOG_ERR, "Error allocating buf for GetAdaptersAddresses()");
        ABORT(R_NO_MEMORY);
      }

      r = GetAdaptersAddresses(AF_UNSPEC, GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER, NULL, AdapterAddresses, &buflen);
      if (r == NO_ERROR) {
        break;
      }
      r_log(NR_LOG_STUN, LOG_ERR, "GetAdaptersAddresses() returned error (%d)", r);
      free(AdapterAddresses);
      AdapterAddresses = NULL;
    }

    if (n >= 5) {
      r_log(NR_LOG_STUN, LOG_ERR, "5 failures calling GetAdaptersAddresses()");
      ABORT(R_INTERNAL);
    }

    n = 0;

    /* Loop through the adapters */

    for (tmpAddress = AdapterAddresses; tmpAddress != NULL; tmpAddress = tmpAddress->Next) {

      if (tmpAddress->OperStatus != IfOperStatusUp)
        continue;

      if ((tmpAddress->IfIndex != 0) || (tmpAddress->Ipv6IfIndex != 0)) {
        IP_ADAPTER_UNICAST_ADDRESS *u = 0;

        if(r=nr_crypto_md5((UCHAR *)tmpAddress->FriendlyName,
                           wcslen(tmpAddress->FriendlyName) * sizeof(wchar_t),
                           (UCHAR *)bin_hashed_ifname))
          ABORT(r);
        if(r=nr_bin2hex((UCHAR*)bin_hashed_ifname, sizeof(bin_hashed_ifname),
                        (UCHAR*)hex_hashed_ifname))
          ABORT(r);

        for (u = tmpAddress->FirstUnicastAddress; u != 0; u = u->Next) {
          SOCKET_ADDRESS *sa_addr = &u->Address;

          if ((sa_addr->lpSockaddr->sa_family != AF_INET) &&
              (sa_addr->lpSockaddr->sa_family != AF_INET6)) {
            r_log(NR_LOG_STUN, LOG_DEBUG, "Unrecognized sa_family for address on adapter %lu", tmpAddress->IfIndex);
            continue;
          }

          if (stun_win32_address_disallowed(u)) {
            continue;
          }

          if ((r=nr_sockaddr_to_transport_addr((struct sockaddr*)sa_addr->lpSockaddr, IPPROTO_UDP, 0, &(addrs[n].addr)))) {
            ABORT(r);
          }

          strlcpy(addrs[n].addr.ifname, hex_hashed_ifname, sizeof(addrs[n].addr.ifname));
          if (tmpAddress->IfType == IF_TYPE_ETHERNET_CSMACD) {
            addrs[n].iface.type = NR_INTERFACE_TYPE_WIRED;
          } else if (tmpAddress->IfType == IF_TYPE_IEEE80211) {
            /* Note: this only works for >= Win Vista */
            addrs[n].iface.type = NR_INTERFACE_TYPE_WIFI;
          } else {
            addrs[n].iface.type = NR_INTERFACE_TYPE_UNKNOWN;
          }
          addrs[n].iface.estimated_speed = tmpAddress->TransmitLinkSpeed / 1000;
          if (stun_win32_address_temp_v6(u)) {
            addrs[n].flags |= NR_ADDR_FLAG_TEMPORARY;
          }

          if (++n >= maxaddrs)
            goto done;
        }
      }
    }

   done:
    *count = n;
    _status = 0;

  abort:
    free(AdapterAddresses);
    return _status;
}

#endif //WIN32

