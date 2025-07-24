/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "txNodeSorter.h"
#include "txExecutionState.h"
#include "txXPathResultComparator.h"
#include "nsGkAtoms.h"
#include "txNodeSetContext.h"
#include "txExpr.h"
#include "txStringUtils.h"

#include "mozilla/CheckedInt.h"
#include "mozilla/UniquePtrExtensions.h"
#include "nsRFPService.h"

using mozilla::CheckedUint32;
using mozilla::MakeUnique;
using mozilla::MakeUniqueFallible;
using mozilla::nsRFPService;
using mozilla::RFPTarget;
using mozilla::UniquePtr;

/*
 * Sorts Nodes as specified by the W3C XSLT 1.0 Recommendation
 */

txNodeSorter::txNodeSorter() : mNKeys(0) {}

txNodeSorter::~txNodeSorter() {
  txListIterator iter(&mSortKeys);
  while (iter.hasNext()) {
    SortKey* key = (SortKey*)iter.next();
    delete key->mComparator;
    delete key;
  }
}

nsresult txNodeSorter::addSortElement(Expr* aSelectExpr, Expr* aLangExpr,
                                      Expr* aDataTypeExpr, Expr* aOrderExpr,
                                      Expr* aCaseOrderExpr,
                                      txIEvalContext* aContext) {
  UniquePtr<SortKey> key(new SortKey);
  nsresult rv = NS_OK;

  // Select
  key->mExpr = aSelectExpr;

  // Order
  bool ascending = true;
  if (aOrderExpr) {
    nsAutoString attrValue;
    rv = aOrderExpr->evaluateToString(aContext, attrValue);
    NS_ENSURE_SUCCESS(rv, rv);

    if (TX_StringEqualsAtom(attrValue, nsGkAtoms::descending)) {
      ascending = false;
    } else if (!TX_StringEqualsAtom(attrValue, nsGkAtoms::ascending)) {
      // XXX ErrorReport: unknown value for order attribute
      return NS_ERROR_XSLT_BAD_VALUE;
    }
  }

  // Create comparator depending on datatype
  nsAutoString dataType;
  if (aDataTypeExpr) {
    rv = aDataTypeExpr->evaluateToString(aContext, dataType);
    NS_ENSURE_SUCCESS(rv, rv);
  }

  if (!aDataTypeExpr || TX_StringEqualsAtom(dataType, nsGkAtoms::text)) {
    // Text comparator

    // Language
    nsAutoString lang;
    if (aLangExpr) {
      rv = aLangExpr->evaluateToString(aContext, lang);
      NS_ENSURE_SUCCESS(rv, rv);
    } else if (aContext->getContextNode()
                   .OwnerDoc()
                   ->ShouldResistFingerprinting(RFPTarget::JSLocale)) {
      CopyUTF8toUTF16(nsRFPService::GetSpoofedJSLocale(), lang);
    }

    // Case-order
    bool upperFirst = false;
    if (aCaseOrderExpr) {
      nsAutoString attrValue;

      rv = aCaseOrderExpr->evaluateToString(aContext, attrValue);
      NS_ENSURE_SUCCESS(rv, rv);

      if (TX_StringEqualsAtom(attrValue, nsGkAtoms::upperFirst)) {
        upperFirst = true;
      } else if (!TX_StringEqualsAtom(attrValue, nsGkAtoms::lowerFirst)) {
        // XXX ErrorReport: unknown value for case-order attribute
        return NS_ERROR_XSLT_BAD_VALUE;
      }
    }

    UniquePtr<txResultStringComparator> comparator =
        MakeUnique<txResultStringComparator>(ascending, upperFirst);
    rv = comparator->init(lang);
    NS_ENSURE_SUCCESS(rv, rv);

    key->mComparator = comparator.release();
  } else if (TX_StringEqualsAtom(dataType, nsGkAtoms::number)) {
    // Number comparator
    key->mComparator = new txResultNumberComparator(ascending);
  } else {
    // XXX ErrorReport: unknown data-type
    return NS_ERROR_XSLT_BAD_VALUE;
  }

  // mSortKeys owns key now.
  mSortKeys.add(key.release());
  mNKeys++;

  return NS_OK;
}

nsresult txNodeSorter::sortNodeSet(txNodeSet* aNodes, txExecutionState* aEs,
                                   txNodeSet** aResult) {
  if (mNKeys == 0 || aNodes->isEmpty()) {
    RefPtr<txNodeSet> ref(aNodes);
    ref.forget(aResult);

    return NS_OK;
  }

  *aResult = nullptr;

  RefPtr<txNodeSet> sortedNodes;
  nsresult rv = aEs->recycler()->getNodeSet(getter_AddRefs(sortedNodes));
  NS_ENSURE_SUCCESS(rv, rv);

  // Create and set up memoryblock for sort-values and indexarray
  CheckedUint32 len = aNodes->size();
  CheckedUint32 numSortValues = len * mNKeys;
  CheckedUint32 sortValuesSize = numSortValues * sizeof(txObject*);
  if (!sortValuesSize.isValid()) {
    return NS_ERROR_OUT_OF_MEMORY;
  }

  nsTArray<uint32_t> indexes(len.value());
  indexes.SetLengthAndRetainStorage(len.value());
  nsTArray<UniquePtr<txObject>> sortValues(numSortValues.value());
  sortValues.SetLengthAndRetainStorage(numSortValues.value());

  uint32_t i;
  for (i = 0; i < len.value(); ++i) {
    indexes[i] = i;
  }

  auto nodeSetContext = MakeUnique<txNodeSetContext>(aNodes, aEs);

  // Sort the indexarray
  SortData sortData{this, nodeSetContext.get(), sortValues.Elements(), NS_OK};

  aEs->pushEvalContext(nodeSetContext.release());

  indexes.StableSort([&sortData](uint32_t left, uint32_t right) {
    return compareNodes(left, right, sortData);
  });

  if (NS_FAILED(sortData.mRv)) {
    // The txExecutionState owns the evalcontext so no need to handle it
    return sortData.mRv;
  }

  // Insert nodes in sorted order in new nodeset
  for (i = 0; i < len.value(); ++i) {
    rv = sortedNodes->append(aNodes->get(indexes[i]));
    if (NS_FAILED(rv)) {
      // The txExecutionState owns the evalcontext so no need to handle it
      return rv;
    }
  }

  delete aEs->popEvalContext();

  sortedNodes.forget(aResult);

  return NS_OK;
}

int txNodeSorter::compareNodes(uint32_t aIndexA, uint32_t aIndexB,
                               SortData& aSortData) {
  txListIterator iter(&aSortData.mNodeSorter->mSortKeys);
  UniquePtr<txObject>* sortValuesA =
      aSortData.mSortValues + aIndexA * aSortData.mNodeSorter->mNKeys;
  UniquePtr<txObject>* sortValuesB =
      aSortData.mSortValues + aIndexB * aSortData.mNodeSorter->mNKeys;

  unsigned int i;
  // Step through each key until a difference is found
  for (i = 0; i < aSortData.mNodeSorter->mNKeys; ++i) {
    SortKey* key = (SortKey*)iter.next();
    // Lazy create sort values
    if (!sortValuesA[i]) {
      sortValuesA[i] = calcSortValue(key, &aSortData, aIndexA);
    }
    if (!sortValuesB[i]) {
      sortValuesB[i] = calcSortValue(key, &aSortData, aIndexB);
    }

    // Compare node values
    int compRes = key->mComparator->compareValues(sortValuesA[i].get(),
                                                  sortValuesB[i].get());
    if (compRes != 0) {
      return compRes;
    }
  }

  // All keys have the same value for these nodes.
  return 0;
}

// static
UniquePtr<txObject> txNodeSorter::calcSortValue(SortKey* aKey,
                                                SortData* aSortData,
                                                uint32_t aNodeIndex) {
  aSortData->mContext->setPosition(aNodeIndex + 1);  // position is 1-based

  UniquePtr<txObject> sortValue;
  nsresult rv;
  std::tie(sortValue, rv) =
      aKey->mComparator->createSortableValue(aKey->mExpr, aSortData->mContext);
  if (NS_FAILED(rv) && NS_SUCCEEDED(aSortData->mRv)) {
    // Record the first failure.
    aSortData->mRv = rv;
  }
  return sortValue;
}
