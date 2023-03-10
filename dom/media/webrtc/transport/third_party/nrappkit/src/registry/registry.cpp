/*
 *
 *    registry.c
 *
 *    $Source: /Users/ekr/tmp/nrappkit-dump/nrappkit/src/registry/registry.c,v $
 *    $Revision: 1.6 $
 *    $Date: 2007/11/21 00:09:12 $
 *
 *    Datastore for tracking configuration and related info.
 *
 *
 *    Copyright (C) 2005, Network Resonance, Inc.
 *    Copyright (C) 2006, Network Resonance, Inc.
 *    All Rights Reserved
 *
 *    Redistribution and use in source and binary forms, with or without
 *    modification, are permitted provided that the following conditions
 *    are met:
 *
 *    1. Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *    2. Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *    3. Neither the name of Network Resonance, Inc. nor the name of any
 *       contributors to this software may be used to endorse or promote
 *       products derived from this software without specific prior written
 *       permission.
 *
 *    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS ``AS IS''
 *    AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 *    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 *    ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
 *    LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 *    CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 *    SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 *    INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 *    CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 *    ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *    POSSIBILITY OF SUCH DAMAGE.
 *
 *
 */

#include <assert.h>
#include <string.h>
#ifndef WIN32
#include <strings.h>
#include <sys/param.h>
#include <netinet/in.h>
#endif
#ifdef OPENSSL
#include <openssl/ssl.h>
#endif
#include <ctype.h>
#include <csi_platform.h>
#include "registry.h"
#include "registry_int.h"
#include "r_assoc.h"
#include "r_log.h"
#include "r_errors.h"
#include "r_macros.h"

static int reg_initted = 0;

/* must be in the order the types are numbered */
static const char *typenames[] = { "char", "UCHAR", "INT2", "UINT2", "INT4", "UINT4", "INT8", "UINT8", "double", "Data", "string", "registry" };

int NR_LOG_REGISTRY=0;

NR_registry_name NR_TOP_LEVEL_REGISTRY = "";

int
NR_reg_init()
{
    int r, _status;
#ifdef SANITY_CHECKS
    NR_registry registry;
#endif

    if (reg_initted) {
        return(0);
    }

    reg_initted = 1;

    if ((r=nr_reg_local_init()))
        ABORT(r);

#ifdef SANITY_CHECKS
    if ((r=NR_reg_get_registry(NR_TOP_LEVEL_REGISTRY, registry)))
        ABORT(r);
    assert(strcmp(registry, NR_TOP_LEVEL_REGISTRY) == 0);
#endif

     r_log_init();
     r_log_register("registry",&NR_LOG_REGISTRY);

    _status=0;
  abort:
    r_log(NR_LOG_REGISTRY,
          (_status ? LOG_ERR                        :  LOG_INFO),
          (_status ? "Couldn't initialize registry" : "Initialized registry"));
    return(_status);
}

int
NR_reg_initted(void)
{
    return reg_initted!=0;
}

#define NRREGGET(func, TYPE, type)                                  \
int                                                                 \
func(NR_registry_name name, type *out)                              \
{                                                                   \
    return nr_reg_get(name, TYPE, out);                             \
}

NRREGGET(NR_reg_get_char,     NR_REG_TYPE_CHAR,     char)
NRREGGET(NR_reg_get_uchar,    NR_REG_TYPE_UCHAR,    UCHAR)
NRREGGET(NR_reg_get_uint2,    NR_REG_TYPE_UINT2,    UINT2)
NRREGGET(NR_reg_get_int4,     NR_REG_TYPE_INT4,     INT4)
NRREGGET(NR_reg_get_uint4,    NR_REG_TYPE_UINT4,    UINT4)
NRREGGET(NR_reg_get_uint8,    NR_REG_TYPE_UINT8,    UINT8)
NRREGGET(NR_reg_get_double,   NR_REG_TYPE_DOUBLE,   double)

int
NR_reg_get_registry(NR_registry_name name, NR_registry out)
{
    int r, _status;
    nr_scalar_registry_node *node = 0;
    int free_node = 0;

    if ((r=nr_reg_fetch_node(name, NR_REG_TYPE_REGISTRY, (nr_registry_node**)&node, &free_node)))
      ABORT(r);

    strncpy(out, name, sizeof(NR_registry));

    _status=0;
  abort:
    if (free_node) free(node);
    return(_status);

}

int
NR_reg_get_bytes(NR_registry_name name, UCHAR *out, size_t size, size_t *length)
{
    return nr_reg_get_array(name, NR_REG_TYPE_BYTES, out, size, length);
}

int
NR_reg_get_string(NR_registry_name name, char *out, size_t size)
{
    return nr_reg_get_array(name, NR_REG_TYPE_STRING, (UCHAR*)out, size, 0);
}

int
NR_reg_get_length(NR_registry_name name, size_t *length)
{
    return nr_reg_local_get_length(name, length);
}

#define NRREGSET(func, TYPE, type)                         \
int                                                             \
func(NR_registry_name name, type data)                          \
{                                                               \
    return nr_reg_set(name, TYPE, &data);                       \
}

NRREGSET(NR_reg_set_char,     NR_REG_TYPE_CHAR,     char)
NRREGSET(NR_reg_set_uchar,    NR_REG_TYPE_UCHAR,    UCHAR)
NRREGSET(NR_reg_set_int4,     NR_REG_TYPE_INT4,     INT4)
NRREGSET(NR_reg_set_uint4,    NR_REG_TYPE_UINT4,    UINT4)

int
NR_reg_set_string(NR_registry_name name, const char *data)
{
    return nr_reg_set_array(name, NR_REG_TYPE_STRING, (const UCHAR*)data, strlen(data)+1);
}

int
NR_reg_set_registry(NR_registry_name name)
{
    return nr_reg_set(name, NR_REG_TYPE_REGISTRY, 0);
}


int
NR_reg_del(NR_registry_name name)
{
    return nr_reg_local_del(name);
}

int
NR_reg_get_child_count(NR_registry_name parent, unsigned int *count)
{
    assert(sizeof(count) == sizeof(size_t));
    return nr_reg_local_get_child_count(parent, (size_t*)count);
}

int
NR_reg_get_child_registry(NR_registry_name parent, unsigned int i, NR_registry child)
{
    int r, _status;
    size_t count;
    NR_registry *children=0;

    if ((r=nr_reg_local_get_child_count(parent, &count)))
      ABORT(r);

    if (i >= count)
        ABORT(R_NOT_FOUND);
    else {
        count++;
        children = R_NEW_CNT(NR_registry, count);
        if (!children)
            ABORT(R_NO_MEMORY);

        if ((r=nr_reg_local_get_children(parent, children, count, &count)))
            ABORT(r);

        if (i >= count)
            ABORT(R_NOT_FOUND);

        strncpy(child, children[i], sizeof(NR_registry));
    }

    _status=0;
  abort:
    free(children);
    return(_status);
}

// convenience methods, call free on the returned data
int
NR_reg_alloc_data(NR_registry_name name, Data *data)
{
    int r, _status;
    size_t length;
    UCHAR  *tmp = 0;
    size_t sanity_check;

    if ((r=NR_reg_get_length(name, &length)))
      ABORT(r);

    if (!(tmp = (UCHAR*)malloc(length)))
      ABORT(R_NO_MEMORY);

    if ((r=NR_reg_get_bytes(name, tmp, length, &sanity_check)))
      ABORT(r);

    assert(length == sanity_check);

    data->len = length;
    data->data = tmp;

    _status=0;
  abort:
    if (_status) {
      if (tmp) free(tmp);
    }
    return(_status);
}

int
NR_reg_alloc_string(NR_registry_name name, char **data)
{
    int r, _status;
    size_t length;
    char  *tmp = 0;

    if ((r=NR_reg_get_length(name, &length)))
      ABORT(r);

    if (!(tmp = (char*)malloc(length+1)))
      ABORT(R_NO_MEMORY);

    if ((r=NR_reg_get_string(name, tmp, length+1)))
      ABORT(r);

    assert(length == strlen(tmp));

    *data = tmp;

    _status=0;
  abort:
    if (_status) {
      if (tmp) free(tmp);
    }
    return(_status);
}


const char *
nr_reg_type_name(int type)
{
    if ((type < NR_REG_TYPE_CHAR) || (type > NR_REG_TYPE_REGISTRY))
       return(NULL);

    return(typenames[type]);
}

/* More convenience functions: the same as their parents but they
   take a prefix and a suffix */
#define NRGET2(func, type, get) \
int                                                                  \
func(NR_registry_name parent, const char *child, type *out)          \
{                                                                    \
  int r, _status;                                                    \
  NR_registry registry;                                              \
                                                                     \
  if ((r = NR_reg_make_registry(parent, child, registry)))           \
    ABORT(r);                                                        \
                                                                     \
  if ((r = get(registry, out))) {                                    \
    ABORT(r);                                                        \
  }                                                                  \
                                                                     \
  _status = 0;                                                       \
abort:                                                               \
  return (_status);                                                  \
}

NRGET2(NR_reg_get2_char,     char,    NR_reg_get_char)
NRGET2(NR_reg_get2_uchar,    UCHAR,   NR_reg_get_uchar)
NRGET2(NR_reg_get2_uint2,    UINT2,   NR_reg_get_uint2)
NRGET2(NR_reg_alloc2_string,   char*,   NR_reg_alloc_string)
NRGET2(NR_reg_alloc2_data,     Data,    NR_reg_alloc_data)

/* More convenience functions: the same as their parents but they
   take a prefix and a suffix */
#define NRSET2(func, type, set) \
int                                                                  \
func(NR_registry_name parent, const char *child, type in)            \
{                                                                    \
  int r, _status;                                                    \
  NR_registry registry;                                              \
                                                                     \
  if ((r = NR_reg_make_registry(parent, child, registry)))           \
    ABORT(r);                                                        \
                                                                     \
  if ((r = set(registry, in))) {                                     \
    ABORT(r);                                                        \
  }                                                                  \
                                                                     \
  _status = 0;                                                       \
abort:                                                               \
  return (_status);                                                  \
}

NRSET2(NR_reg_set2_uchar,    UCHAR,   NR_reg_set_uchar)

/* requires parent already in legal form */
int
NR_reg_make_registry(NR_registry_name parent, const char *child, NR_registry out)
{
    int r, _status;
    size_t plen;
    size_t clen;
    char *c = 0;
    size_t i;

    if ((r=nr_reg_is_valid(parent)))
        ABORT(r);

    if (*child == '.')
        ABORT(R_BAD_ARGS);

    clen = strlen(child);
    if (!clen)
        ABORT(R_BAD_ARGS);
    plen = strlen(parent);
    if ((plen + clen + 2) > sizeof(NR_registry))
        ABORT(R_BAD_ARGS);

    if (out != parent)
        strcpy(out, parent);

    c = &(out[plen]);

    if (parent[0] != '\0') {
        *c = '.';
        ++c;
    }

    for (i = 0; i < clen; ++i, ++c) {
        *c = child[i];
        if (isspace(*c) || *c == '.' || *c == '/' || ! isprint(*c))
            *c = '_';
    }

    *c = '\0';

    _status = 0;
abort:
    return _status;
}

