/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

use super::error_reporter::ErrorReporter;
use super::stylesheet_loader::{AsyncStylesheetParser, StylesheetLoader};
use bincode::{deserialize, serialize};
use cssparser::ToCss as ParserToCss;
use cssparser::{
    BasicParseError, ParseError as CssParseError, Parser, ParserInput, ParserState, SourceLocation,
    Token, UnicodeRange,
};
use dom::{DocumentState, ElementState};
use malloc_size_of::MallocSizeOfOps;
use nsstring::{nsCString, nsString};
use selectors::matching::{ElementSelectorFlags, MatchingForInvalidation, SelectorCaches};
use selectors::{Element, OpaqueElement};
use servo_arc::{Arc, ArcBorrow};
use smallvec::SmallVec;
use std::collections::BTreeSet;
use std::fmt::Write;
use std::iter;
use std::os::raw::c_void;
use std::ptr;
use style::color::mix::ColorInterpolationMethod;
use style::color::{AbsoluteColor, ColorSpace};
use style::computed_value_flags::ComputedValueFlags;
use style::context::ThreadLocalStyleContext;
use style::context::{CascadeInputs, QuirksMode, SharedStyleContext, StyleContext};
use style::counter_style;
use style::custom_properties::DeferFontRelativeCustomPropertyResolution;
use style::data::{self, ElementStyles};
use style::dom::{ShowSubtreeData, TDocument, TElement, TNode};
use style::driver;
use style::error_reporting::{ParseErrorReporter, SelectorWarningKind};
use style::font_face::{self, FontFaceSourceFormat, FontFaceSourceListComponent, Source};
use style::gecko::arc_types::{
    LockedCounterStyleRule, LockedCssRules, LockedDeclarationBlock, LockedFontFaceRule,
    LockedImportRule, LockedKeyframe, LockedKeyframesRule, LockedMediaList, LockedPageRule,
    LockedStyleRule,
};
use style::gecko::data::{
    AuthorStyles, GeckoStyleSheet, PerDocumentStyleData, PerDocumentStyleDataImpl,
};
use style::gecko::restyle_damage::GeckoRestyleDamage;
use style::gecko::selector_parser::{NonTSPseudoClass, PseudoElement};
use style::gecko::snapshot_helpers::classes_changed;
use style::gecko::traversal::RecalcStyleOnly;
use style::gecko::url;
use style::gecko::wrapper::{
    slow_selector_flags_from_node_selector_flags, GeckoElement, GeckoNode,
};
use style::gecko_bindings::bindings;
use style::gecko_bindings::bindings::nsACString;
use style::gecko_bindings::bindings::nsAString;
use style::gecko_bindings::bindings::Gecko_AddPropertyToSet;
use style::gecko_bindings::bindings::Gecko_ConstructFontFeatureValueSet;
use style::gecko_bindings::bindings::Gecko_ConstructFontPaletteValueSet;
use style::gecko_bindings::bindings::Gecko_HaveSeenPtr;
use style::gecko_bindings::structs;
use style::gecko_bindings::structs::gfx::FontPaletteValueSet;
use style::gecko_bindings::structs::gfxFontFeatureValueSet;
use style::gecko_bindings::structs::ipc::ByteBuf;
use style::gecko_bindings::structs::nsAtom;
use style::gecko_bindings::structs::nsCSSCounterDesc;
use style::gecko_bindings::structs::nsCSSFontDesc;
use style::gecko_bindings::structs::nsCSSPropertyID;
use style::gecko_bindings::structs::nsChangeHint;
use style::gecko_bindings::structs::nsCompatibility;
use style::gecko_bindings::structs::nsStyleTransformMatrix::MatrixTransformOperator;
use style::gecko_bindings::structs::nsresult;
use style::gecko_bindings::structs::CallerType;
use style::gecko_bindings::structs::CompositeOperation;
use style::gecko_bindings::structs::DeclarationBlockMutationClosure;
use style::gecko_bindings::structs::GeckoFontMetrics;
use style::gecko_bindings::structs::IterationCompositeOperation;
use style::gecko_bindings::structs::Loader;
use style::gecko_bindings::structs::LoaderReusableStyleSheets;
use style::gecko_bindings::structs::MallocSizeOf as GeckoMallocSizeOf;
use style::gecko_bindings::structs::OriginFlags;
use style::gecko_bindings::structs::PropertyValuePair;
use style::gecko_bindings::structs::PseudoStyleType;
use style::gecko_bindings::structs::SeenPtrs;
use style::gecko_bindings::structs::ServoElementSnapshotTable;
use style::gecko_bindings::structs::ServoStyleSetSizes;
use style::gecko_bindings::structs::ServoTraversalFlags;
use style::gecko_bindings::structs::SheetLoadData;
use style::gecko_bindings::structs::SheetLoadDataHolder;
use style::gecko_bindings::structs::SheetParsingMode;
use style::gecko_bindings::structs::StyleRuleInclusion;
use style::gecko_bindings::structs::StyleSheet as DomStyleSheet;
use style::gecko_bindings::structs::URLExtraData;
use style::gecko_bindings::structs::{nsINode as RawGeckoNode, Element as RawGeckoElement};
use style::gecko_bindings::sugar::ownership::Strong;
use style::gecko_bindings::sugar::refptr::RefPtr;
use style::global_style_data::{
    GlobalStyleData, PlatformThreadHandle, StyleThreadPool, GLOBAL_STYLE_DATA, STYLE_THREAD_POOL,
};
use style::invalidation::element::element_wrapper::{ElementSnapshot, ElementWrapper};
use style::invalidation::element::invalidation_map::{
    RelativeSelectorInvalidationMap, TSStateForInvalidation,
};
use style::invalidation::element::invalidator::{InvalidationResult, SiblingTraversalMap};
use style::invalidation::element::relative_selector::{
    DomMutationOperation, RelativeSelectorDependencyCollector, RelativeSelectorInvalidator,
};
use style::invalidation::element::restyle_hints::RestyleHint;
use style::invalidation::stylesheets::RuleChangeKind;
use style::media_queries::MediaList;
use style::parser::{Parse, ParserContext};
#[cfg(feature = "gecko_debug")]
use style::properties::LonghandIdSet;
use style::properties::{
    animated_properties::{AnimationValue, AnimationValueMap},
    parse_one_declaration_into, parse_style_attribute, ComputedValues, CountedUnknownProperty,
    Importance, LonghandId, NonCustomPropertyId, OwnedPropertyDeclarationId,
    PropertyDeclarationBlock, PropertyDeclarationId, PropertyDeclarationIdSet, PropertyId,
    ShorthandId, SourcePropertyDeclaration, StyleBuilder,
};
use style::properties_and_values::registry::{PropertyRegistration, PropertyRegistrationData};
use style::properties_and_values::rule::Inherits as PropertyInherits;
use style::rule_cache::RuleCacheConditions;
use style::rule_tree::StrongRuleNode;
use style::selector_parser::PseudoElementCascadeType;
use style::shared_lock::{
    Locked, SharedRwLock, SharedRwLockReadGuard, StylesheetGuards, ToCssWithGuard,
};
use style::string_cache::{Atom, WeakAtom};
use style::style_adjuster::StyleAdjuster;
use style::stylesheets::container_rule::ContainerSizeQuery;
use style::stylesheets::import_rule::{ImportLayer, ImportSheet};
use style::stylesheets::keyframes_rule::{Keyframe, KeyframeSelector, KeyframesStepValue};
use style::stylesheets::supports_rule::parse_condition_or_declaration;
use style::stylesheets::{
    AllowImportRules, ContainerRule, CounterStyleRule, CssRule, CssRuleType, CssRuleTypes,
    CssRules, CssRulesHelpers, DocumentRule, FontFaceRule, FontFeatureValuesRule,
    FontPaletteValuesRule, ImportRule, KeyframesRule, LayerBlockRule, LayerStatementRule,
    MarginRule, MediaRule, NamespaceRule, Origin, OriginSet, PagePseudoClassFlags, PageRule,
    PropertyRule, SanitizationData, SanitizationKind, ScopeRule, StartingStyleRule, StyleRule,
    StylesheetContents, StylesheetLoader as StyleStylesheetLoader, SupportsRule, UrlExtraData,
};
use style::stylist::{add_size_of_ua_cache, AuthorStylesEnabled, RuleInclusion, Stylist};
use style::thread_state;
use style::traversal::resolve_style;
use style::traversal::DomTraversal;
use style::traversal_flags::{self, TraversalFlags};
use style::use_counters::UseCounters;
use style::values::animated::{Animate, Procedure, ToAnimatedZero};
use style::values::computed::easing::ComputedTimingFunction;
use style::values::computed::effects::Filter;
use style::values::computed::font::{
    FamilyName, FontFamily, FontFamilyList, FontStretch, FontStyle, FontWeight, GenericFontFamily,
};
use style::values::computed::{self, Context, ToComputedValue};
use style::values::distance::ComputeSquaredDistance;
use style::values::generics::color::ColorMixFlags;
use style::values::generics::easing::BeforeFlag;
use style::values::resolved;
use style::values::specified::gecko::IntersectionObserverRootMargin;
use style::values::specified::source_size_list::SourceSizeList;
use style::values::specified::{AbsoluteLength, NoCalcLength};
use style::values::{specified, AtomIdent, CustomIdent, KeyframesName};
use style_traits::{CssWriter, ParseError, ParsingMode, ToCss};
use thin_vec::ThinVec as nsTArray;
use to_shmem::SharedMemoryBuilder;

trait ClosureHelper {
    fn invoke(&self, property_id: Option<NonCustomPropertyId>);
}

impl ClosureHelper for DeclarationBlockMutationClosure {
    #[inline]
    fn invoke(&self, property_id: Option<NonCustomPropertyId>) {
        if let Some(function) = self.function.as_ref() {
            let gecko_prop_id = match property_id {
                Some(p) => p.to_nscsspropertyid(),
                None => nsCSSPropertyID::eCSSPropertyExtra_variable,
            };
            unsafe { function(self.data, gecko_prop_id) }
        }
    }
}

/*
 * For Gecko->Servo function calls, we need to redeclare the same signature that was declared in
 * the C header in Gecko. In order to catch accidental mismatches, we run rust-bindgen against
 * those signatures as well, giving us a second declaration of all the Servo_* functions in this
 * crate. If there's a mismatch, LLVM will assert and abort, which is a rather awful thing to
 * depend on but good enough for our purposes.
 */

// A dummy url data for where we don't pass url data in.
static mut DUMMY_URL_DATA: *mut URLExtraData = 0 as *mut _;
static mut DUMMY_CHROME_URL_DATA: *mut URLExtraData = 0 as *mut _;

#[no_mangle]
pub unsafe extern "C" fn Servo_Initialize(
    dummy_url_data: *mut URLExtraData,
    dummy_chrome_url_data: *mut URLExtraData,
) {
    use style::gecko_bindings::sugar::origin_flags;

    // Pretend that we're a Servo Layout thread, to make some assertions happy.
    thread_state::initialize(thread_state::ThreadState::LAYOUT);

    debug_assert!(is_main_thread());
    lazy_static::initialize(&STYLE_THREAD_POOL);

    // Perform some debug-only runtime assertions.
    origin_flags::assert_flags_match();
    traversal_flags::assert_traversal_flags_match();

    DUMMY_URL_DATA = dummy_url_data;
    DUMMY_CHROME_URL_DATA = dummy_chrome_url_data;
}

#[no_mangle]
pub unsafe extern "C" fn Servo_Shutdown() {
    DUMMY_URL_DATA = ptr::null_mut();
    DUMMY_CHROME_URL_DATA = ptr::null_mut();
    Stylist::shutdown();
    url::shutdown();
}

#[inline(always)]
unsafe fn dummy_url_data() -> &'static UrlExtraData {
    UrlExtraData::from_ptr_ref(std::ptr::addr_of!(DUMMY_URL_DATA).as_ref().unwrap())
}

#[inline(always)]
unsafe fn dummy_chrome_url_data() -> &'static UrlExtraData {
    UrlExtraData::from_ptr_ref(std::ptr::addr_of!(DUMMY_CHROME_URL_DATA).as_ref().unwrap())
}

#[allow(dead_code)]
fn is_main_thread() -> bool {
    unsafe { bindings::Gecko_IsMainThread() }
}

#[allow(dead_code)]
fn is_dom_worker_thread() -> bool {
    unsafe { bindings::Gecko_IsDOMWorkerThread() }
}

thread_local! {
    /// Thread-local style data for DOM workers
    static DOM_WORKER_RWLOCK: SharedRwLock = SharedRwLock::new();
}

#[allow(dead_code)]
fn is_in_servo_traversal() -> bool {
    unsafe { bindings::Gecko_IsInServoTraversal() }
}

fn create_shared_context<'a>(
    global_style_data: &GlobalStyleData,
    guard: &'a SharedRwLockReadGuard,
    stylist: &'a Stylist,
    traversal_flags: TraversalFlags,
    snapshot_map: &'a ServoElementSnapshotTable,
) -> SharedStyleContext<'a> {
    SharedStyleContext {
        stylist: &stylist,
        visited_styles_enabled: stylist.device().visited_styles_enabled(),
        options: global_style_data.options.clone(),
        guards: StylesheetGuards::same(guard),
        current_time_for_animations: 0.0, // Unused for Gecko, at least for now.
        traversal_flags,
        snapshot_map,
    }
}

fn traverse_subtree(
    element: GeckoElement,
    global_style_data: &GlobalStyleData,
    per_doc_data: &PerDocumentStyleDataImpl,
    guard: &SharedRwLockReadGuard,
    traversal_flags: TraversalFlags,
    snapshots: &ServoElementSnapshotTable,
) {
    let shared_style_context = create_shared_context(
        &global_style_data,
        &guard,
        &per_doc_data.stylist,
        traversal_flags,
        snapshots,
    );

    let token = RecalcStyleOnly::pre_traverse(element, &shared_style_context);

    if !token.should_traverse() {
        return;
    }

    debug!("Traversing subtree from {:?}", element);

    let thread_pool_holder = &*STYLE_THREAD_POOL;
    let pool;
    let thread_pool = if traversal_flags.contains(TraversalFlags::ParallelTraversal) {
        pool = thread_pool_holder.pool();
        pool.as_ref()
    } else {
        None
    };

    let traversal = RecalcStyleOnly::new(shared_style_context);
    driver::traverse_dom(&traversal, token, thread_pool);
}

/// Traverses the subtree rooted at `root` for restyling.
///
/// Returns whether the root was restyled. Whether anything else was restyled or
/// not can be inferred from the dirty bits in the rest of the tree.
#[no_mangle]
pub extern "C" fn Servo_TraverseSubtree(
    root: &RawGeckoElement,
    raw_data: &PerDocumentStyleData,
    snapshots: *const ServoElementSnapshotTable,
    raw_flags: ServoTraversalFlags,
) -> bool {
    let traversal_flags = TraversalFlags::from_bits_retain(raw_flags);
    debug_assert!(!snapshots.is_null());

    let element = GeckoElement(root);

    debug!("Servo_TraverseSubtree (flags={:?})", traversal_flags);
    debug!("{:?}", ShowSubtreeData(element.as_node()));

    if cfg!(debug_assertions) {
        if let Some(parent) = element.traversal_parent() {
            let data = parent
                .borrow_data()
                .expect("Styling element with unstyled parent");
            assert!(
                !data.styles.is_display_none(),
                "Styling element with display: none parent"
            );
        }
    }

    let needs_animation_only_restyle =
        element.has_animation_only_dirty_descendants() || element.has_animation_restyle_hints();

    let per_doc_data = raw_data.borrow();
    debug_assert!(!per_doc_data.stylist.stylesheets_have_changed());

    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();

    let was_initial_style = !element.has_data();

    if needs_animation_only_restyle {
        debug!(
            "Servo_TraverseSubtree doing animation-only restyle (aodd={})",
            element.has_animation_only_dirty_descendants()
        );
        traverse_subtree(
            element,
            &global_style_data,
            &per_doc_data,
            &guard,
            traversal_flags | TraversalFlags::AnimationOnly,
            unsafe { &*snapshots },
        );
    }

    traverse_subtree(
        element,
        &global_style_data,
        &per_doc_data,
        &guard,
        traversal_flags,
        unsafe { &*snapshots },
    );

    debug!(
        "Servo_TraverseSubtree complete (dd={}, aodd={}, lfcd={}, lfc={}, data={:?})",
        element.has_dirty_descendants(),
        element.has_animation_only_dirty_descendants(),
        element.descendants_need_frames(),
        element.needs_frame(),
        element.borrow_data().unwrap()
    );

    if was_initial_style {
        debug_assert!(!element.borrow_data().unwrap().contains_restyle_data());
        false
    } else {
        let element_was_restyled = element.borrow_data().unwrap().contains_restyle_data();
        element_was_restyled
    }
}

/// Checks whether the rule tree has crossed its threshold for unused nodes, and
/// if so, frees them.
#[no_mangle]
pub extern "C" fn Servo_MaybeGCRuleTree(raw_data: &PerDocumentStyleData) {
    let per_doc_data = raw_data.borrow_mut();
    per_doc_data.stylist.rule_tree().maybe_gc();
}

#[no_mangle]
pub extern "C" fn Servo_AnimationValues_Interpolate(
    from: &AnimationValue,
    to: &AnimationValue,
    progress: f64,
) -> Strong<AnimationValue> {
    if let Ok(value) = from.animate(to, Procedure::Interpolate { progress }) {
        Arc::new(value).into()
    } else {
        Strong::null()
    }
}

#[no_mangle]
pub extern "C" fn Servo_AnimationValues_IsInterpolable(
    from: &AnimationValue,
    to: &AnimationValue,
) -> bool {
    from.interpolable_with(to)
}

#[no_mangle]
pub extern "C" fn Servo_AnimationValues_Add(
    a: &AnimationValue,
    b: &AnimationValue,
) -> Strong<AnimationValue> {
    if let Ok(value) = a.animate(b, Procedure::Add) {
        Arc::new(value).into()
    } else {
        Strong::null()
    }
}

#[no_mangle]
pub extern "C" fn Servo_AnimationValues_Accumulate(
    a: &AnimationValue,
    b: &AnimationValue,
    count: u64,
) -> Strong<AnimationValue> {
    if let Ok(value) = a.animate(b, Procedure::Accumulate { count }) {
        Arc::new(value).into()
    } else {
        Strong::null()
    }
}

#[no_mangle]
pub extern "C" fn Servo_AnimationValues_GetZeroValue(
    value_to_match: &AnimationValue,
) -> Strong<AnimationValue> {
    if let Ok(zero_value) = value_to_match.to_animated_zero() {
        Arc::new(zero_value).into()
    } else {
        Strong::null()
    }
}

#[no_mangle]
pub extern "C" fn Servo_AnimationValues_ComputeDistance(
    from: &AnimationValue,
    to: &AnimationValue,
) -> f64 {
    // If compute_squared_distance() failed, this function will return negative value
    // in order to check whether we support the specified paced animation values.
    from.compute_squared_distance(to).map_or(-1.0, |d| d.sqrt())
}

/// Compute one of the endpoints for the interpolation interval, compositing it with the
/// underlying value if needed.
/// An None returned value means, "Just use endpoint_value as-is."
/// It is the responsibility of the caller to ensure that |underlying_value| is provided
/// when it will be used.
fn composite_endpoint(
    endpoint_value: Option<&AnimationValue>,
    composite: CompositeOperation,
    underlying_value: Option<&AnimationValue>,
) -> Option<AnimationValue> {
    match endpoint_value {
        Some(endpoint_value) => match composite {
            CompositeOperation::Add => underlying_value
                .expect("We should have an underlying_value")
                .animate(endpoint_value, Procedure::Add)
                .ok(),
            CompositeOperation::Accumulate => underlying_value
                .expect("We should have an underlying value")
                .animate(endpoint_value, Procedure::Accumulate { count: 1 })
                .ok(),
            _ => None,
        },
        None => underlying_value.map(|v| v.clone()),
    }
}

/// Accumulate one of the endpoints of the animation interval.
/// A returned value of None means, "Just use endpoint_value as-is."
fn accumulate_endpoint(
    endpoint_value: Option<&AnimationValue>,
    composited_value: Option<AnimationValue>,
    last_value: &AnimationValue,
    current_iteration: u64,
) -> Option<AnimationValue> {
    debug_assert!(
        endpoint_value.is_some() || composited_value.is_some(),
        "Should have a suitable value to use"
    );

    let count = current_iteration;
    match composited_value {
        Some(endpoint) => last_value
            .animate(&endpoint, Procedure::Accumulate { count })
            .ok()
            .or(Some(endpoint)),
        None => last_value
            .animate(endpoint_value.unwrap(), Procedure::Accumulate { count })
            .ok(),
    }
}

/// Compose the animation segment. We composite it with the underlying_value and last_value if
/// needed.
/// The caller is responsible for providing an underlying value and last value
/// in all situations where there are needed.
fn compose_animation_segment(
    segment: &structs::AnimationPropertySegment,
    underlying_value: Option<&AnimationValue>,
    last_value: Option<&AnimationValue>,
    iteration_composite: IterationCompositeOperation,
    current_iteration: u64,
    total_progress: f64,
    segment_progress: f64,
) -> AnimationValue {
    // Extract keyframe values.
    let keyframe_from_value = unsafe { segment.mFromValue.mServo.mRawPtr.as_ref() };
    let keyframe_to_value = unsafe { segment.mToValue.mServo.mRawPtr.as_ref() };
    let mut composited_from_value = composite_endpoint(
        keyframe_from_value,
        segment.mFromComposite,
        underlying_value,
    );
    let mut composited_to_value =
        composite_endpoint(keyframe_to_value, segment.mToComposite, underlying_value);

    debug_assert!(
        keyframe_from_value.is_some() || composited_from_value.is_some(),
        "Should have a suitable from value to use"
    );
    debug_assert!(
        keyframe_to_value.is_some() || composited_to_value.is_some(),
        "Should have a suitable to value to use"
    );

    // Apply iteration composite behavior.
    if iteration_composite == IterationCompositeOperation::Accumulate && current_iteration > 0 {
        let last_value = last_value
            .unwrap_or_else(|| underlying_value.expect("Should have a valid underlying value"));

        composited_from_value = accumulate_endpoint(
            keyframe_from_value,
            composited_from_value,
            last_value,
            current_iteration,
        );
        composited_to_value = accumulate_endpoint(
            keyframe_to_value,
            composited_to_value,
            last_value,
            current_iteration,
        );
    }

    // Use the composited value if there is one, otherwise, use the original keyframe value.
    let from = composited_from_value
        .as_ref()
        .unwrap_or_else(|| keyframe_from_value.unwrap());
    let to = composited_to_value
        .as_ref()
        .unwrap_or_else(|| keyframe_to_value.unwrap());

    if segment.mToKey == segment.mFromKey {
        return if total_progress < 0. {
            from.clone()
        } else {
            to.clone()
        };
    }

    match from.animate(
        to,
        Procedure::Interpolate {
            progress: segment_progress,
        },
    ) {
        Ok(value) => value,
        _ => {
            if segment_progress < 0.5 {
                from.clone()
            } else {
                to.clone()
            }
        },
    }
}

#[no_mangle]
pub extern "C" fn Servo_ComposeAnimationSegment(
    segment: &structs::AnimationPropertySegment,
    underlying_value: Option<&AnimationValue>,
    last_value: Option<&AnimationValue>,
    iteration_composite: IterationCompositeOperation,
    progress: f64,
    current_iteration: u64,
) -> Strong<AnimationValue> {
    let result = compose_animation_segment(
        segment,
        underlying_value,
        last_value,
        iteration_composite,
        current_iteration,
        progress,
        progress,
    );
    Arc::new(result).into()
}

#[no_mangle]
pub extern "C" fn Servo_AnimationCompose(
    value_map: &mut AnimationValueMap,
    base_values: &structs::RawServoAnimationValueTable,
    css_property: &structs::AnimatedPropertyID,
    segment: &structs::AnimationPropertySegment,
    last_segment: &structs::AnimationPropertySegment,
    computed_timing: &structs::ComputedTiming,
    iteration_composite: IterationCompositeOperation,
) {
    use style::gecko_bindings::bindings::Gecko_AnimationGetBaseStyle;
    use style::gecko_bindings::bindings::Gecko_GetPositionInSegment;
    use style::gecko_bindings::bindings::Gecko_GetProgressFromComputedTiming;

    let property = match OwnedPropertyDeclarationId::from_gecko_animated_property_id(css_property) {
        Some(property) if property.as_borrowed().is_animatable() => property,
        _ => return,
    };

    // We will need an underlying value if either of the endpoints is null...
    let need_underlying_value = segment.mFromValue.mServo.mRawPtr.is_null() ||
                                segment.mToValue.mServo.mRawPtr.is_null() ||
                                // ... or if they have a non-replace composite mode ...
                                segment.mFromComposite != CompositeOperation::Replace ||
                                segment.mToComposite != CompositeOperation::Replace ||
                                // ... or if we accumulate onto the last value and it is null.
                                (iteration_composite == IterationCompositeOperation::Accumulate &&
                                 computed_timing.mCurrentIteration > 0 &&
                                 last_segment.mToValue.mServo.mRawPtr.is_null());

    // If either of the segment endpoints are null, get the underlying value to
    // use from the current value in the values map (set by a lower-priority
    // effect), or, if there is no current value, look up the cached base value
    // for this property.
    let underlying_value = if need_underlying_value {
        let previous_composed_value = value_map.get(&property).map(|v| &*v);
        previous_composed_value
            .or_else(|| unsafe { Gecko_AnimationGetBaseStyle(base_values, css_property).as_ref() })
    } else {
        None
    };

    if need_underlying_value && underlying_value.is_none() {
        warn!("Underlying value should be valid when we expect to use it");
        return;
    }

    let last_value = unsafe { last_segment.mToValue.mServo.mRawPtr.as_ref() };
    let progress = unsafe { Gecko_GetProgressFromComputedTiming(computed_timing) };
    let position = if segment.mToKey == segment.mFromKey {
        // Note: compose_animation_segment doesn't use this value
        // if segment.mFromKey == segment.mToKey, so assigning |progress| directly is fine.
        progress
    } else {
        unsafe { Gecko_GetPositionInSegment(segment, progress, computed_timing.mBeforeFlag) }
    };

    let result = compose_animation_segment(
        segment,
        underlying_value,
        last_value,
        iteration_composite,
        computed_timing.mCurrentIteration,
        progress,
        position,
    );
    value_map.insert(property, result);
}

macro_rules! get_property_id_from_nscsspropertyid {
    ($property_id: ident, $ret: expr) => {{
        match PropertyId::from_nscsspropertyid($property_id) {
            Some(property_id) => property_id,
            None => {
                return $ret;
            },
        }
    }};
}

macro_rules! get_property_id_from_animatedpropertyid {
    ($property_id: ident, $ret: expr) => {{
        match PropertyId::from_gecko_animated_property_id($property_id) {
            Some(property_id) => property_id,
            None => {
                return $ret;
            },
        }
    }};
}

#[no_mangle]
pub extern "C" fn Servo_AnimationValue_Serialize(
    value: &AnimationValue,
    property: &structs::AnimatedPropertyID,
    raw_data: &PerDocumentStyleData,
    buffer: &mut nsACString,
) {
    let uncomputed_value = value.uncompute();
    let data = raw_data.borrow();
    let rv = PropertyDeclarationBlock::with_one(uncomputed_value, Importance::Normal)
        .single_value_to_css(
            &get_property_id_from_animatedpropertyid!(property, ()),
            buffer,
            None,
            &data.stylist,
        );
    debug_assert!(rv.is_ok());
}

/// Debug: MOZ_DBG for AnimationValue.
#[no_mangle]
pub extern "C" fn Servo_AnimationValue_Dump(value: &AnimationValue, result: &mut nsACString) {
    write!(result, "{:?}", value).unwrap();
}

#[no_mangle]
pub extern "C" fn Servo_AnimationValue_GetColor(
    value: &AnimationValue,
    foreground_color: structs::nscolor,
) -> structs::nscolor {
    use style::gecko::values::{
        convert_absolute_color_to_nscolor, convert_nscolor_to_absolute_color,
    };
    use style::values::computed::color::Color as ComputedColor;
    match *value {
        AnimationValue::BackgroundColor(ref color) => {
            let computed: ComputedColor = color.clone();
            let foreground_color = convert_nscolor_to_absolute_color(foreground_color);
            convert_absolute_color_to_nscolor(&computed.resolve_to_absolute(&foreground_color))
        },
        _ => panic!("Other color properties are not supported yet"),
    }
}

#[no_mangle]
pub extern "C" fn Servo_AnimationValue_IsCurrentColor(value: &AnimationValue) -> bool {
    match *value {
        AnimationValue::BackgroundColor(ref color) => color.is_currentcolor(),
        _ => {
            debug_assert!(false, "Other color properties are not supported yet");
            false
        },
    }
}

#[no_mangle]
pub extern "C" fn Servo_AnimationValue_GetOpacity(value: &AnimationValue) -> f32 {
    if let AnimationValue::Opacity(opacity) = *value {
        opacity
    } else {
        panic!("The AnimationValue should be Opacity");
    }
}

#[no_mangle]
pub extern "C" fn Servo_AnimationValue_Opacity(opacity: f32) -> Strong<AnimationValue> {
    Arc::new(AnimationValue::Opacity(opacity)).into()
}

#[no_mangle]
pub extern "C" fn Servo_AnimationValue_Color(
    color_property: nsCSSPropertyID,
    color: structs::nscolor,
) -> Strong<AnimationValue> {
    use style::gecko::values::convert_nscolor_to_absolute_color;
    use style::values::animated::color::Color;

    let property = LonghandId::from_nscsspropertyid(color_property)
        .expect("We don't have shorthand property animation value");

    let animated = convert_nscolor_to_absolute_color(color);

    match property {
        LonghandId::BackgroundColor => {
            Arc::new(AnimationValue::BackgroundColor(Color::Absolute(animated))).into()
        },
        _ => panic!("Should be background-color property"),
    }
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AnimationValue_GetScale(
    value: &AnimationValue,
) -> *const computed::Scale {
    match *value {
        AnimationValue::Scale(ref value) => value,
        _ => unreachable!("Expected scale"),
    }
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AnimationValue_GetTranslate(
    value: &AnimationValue,
) -> *const computed::Translate {
    match *value {
        AnimationValue::Translate(ref value) => value,
        _ => unreachable!("Expected translate"),
    }
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AnimationValue_GetRotate(
    value: &AnimationValue,
) -> *const computed::Rotate {
    match *value {
        AnimationValue::Rotate(ref value) => value,
        _ => unreachable!("Expected rotate"),
    }
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AnimationValue_GetTransform(
    value: &AnimationValue,
) -> *const computed::Transform {
    match *value {
        AnimationValue::Transform(ref value) => value,
        _ => unreachable!("Unsupported transform animation value"),
    }
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AnimationValue_GetOffsetPath(
    value: &AnimationValue,
    output: &mut computed::motion::OffsetPath,
) {
    use style::values::animated::ToAnimatedValue;
    match *value {
        AnimationValue::OffsetPath(ref value) => {
            *output = ToAnimatedValue::from_animated_value(value.clone())
        },
        _ => unreachable!("Expected offset-path"),
    }
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AnimationValue_GetOffsetDistance(
    value: &AnimationValue,
) -> *const computed::LengthPercentage {
    match *value {
        AnimationValue::OffsetDistance(ref value) => value,
        _ => unreachable!("Expected offset-distance"),
    }
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AnimationValue_GetOffsetRotate(
    value: &AnimationValue,
) -> *const computed::motion::OffsetRotate {
    match *value {
        AnimationValue::OffsetRotate(ref value) => value,
        _ => unreachable!("Expected offset-rotate"),
    }
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AnimationValue_GetOffsetAnchor(
    value: &AnimationValue,
) -> *const computed::position::PositionOrAuto {
    match *value {
        AnimationValue::OffsetAnchor(ref value) => value,
        _ => unreachable!("Expected offset-anchor"),
    }
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AnimationValue_GetOffsetPosition(
    value: &AnimationValue,
) -> *const computed::motion::OffsetPosition {
    match *value {
        AnimationValue::OffsetPosition(ref value) => value,
        _ => unreachable!("Expected offset-position"),
    }
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AnimationValue_IsOffsetPathUrl(value: &AnimationValue) -> bool {
    use style::values::generics::motion::{GenericOffsetPath, GenericOffsetPathFunction};
    if let AnimationValue::OffsetPath(ref op) = value {
        if let GenericOffsetPath::OffsetPath { path, coord_box: _ } = op {
            return matches!(**path, GenericOffsetPathFunction::Url(_));
        }
    }
    false
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AnimationValue_Rotate(
    r: &computed::Rotate,
) -> Strong<AnimationValue> {
    Arc::new(AnimationValue::Rotate(r.clone())).into()
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AnimationValue_Translate(
    t: &computed::Translate,
) -> Strong<AnimationValue> {
    Arc::new(AnimationValue::Translate(t.clone())).into()
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AnimationValue_Scale(s: &computed::Scale) -> Strong<AnimationValue> {
    Arc::new(AnimationValue::Scale(s.clone())).into()
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AnimationValue_Transform(
    transform: &computed::Transform,
) -> Strong<AnimationValue> {
    Arc::new(AnimationValue::Transform(transform.clone())).into()
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AnimationValue_OffsetPath(
    p: &computed::motion::OffsetPath,
) -> Strong<AnimationValue> {
    use style::values::animated::ToAnimatedValue;
    Arc::new(AnimationValue::OffsetPath(p.clone().to_animated_value())).into()
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AnimationValue_OffsetDistance(
    d: &computed::LengthPercentage,
) -> Strong<AnimationValue> {
    Arc::new(AnimationValue::OffsetDistance(d.clone())).into()
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AnimationValue_OffsetRotate(
    r: &computed::motion::OffsetRotate,
) -> Strong<AnimationValue> {
    Arc::new(AnimationValue::OffsetRotate(*r)).into()
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AnimationValue_OffsetAnchor(
    p: &computed::position::PositionOrAuto,
) -> Strong<AnimationValue> {
    Arc::new(AnimationValue::OffsetAnchor(p.clone())).into()
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AnimationValue_OffsetPosition(
    p: &computed::motion::OffsetPosition,
) -> Strong<AnimationValue> {
    Arc::new(AnimationValue::OffsetPosition(p.clone())).into()
}

#[no_mangle]
pub extern "C" fn Servo_AnimationValue_DeepEqual(
    this: &AnimationValue,
    other: &AnimationValue,
) -> bool {
    this == other
}

#[no_mangle]
pub extern "C" fn Servo_AnimationValue_Uncompute(
    value: &AnimationValue,
) -> Strong<LockedDeclarationBlock> {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    Arc::new(
        global_style_data
            .shared_lock
            .wrap(PropertyDeclarationBlock::with_one(
                value.uncompute(),
                Importance::Normal,
            )),
    )
    .into()
}

#[inline]
fn create_byte_buf_from_vec(mut v: Vec<u8>) -> ByteBuf {
    let w = ByteBuf {
        mData: v.as_mut_ptr(),
        mLen: v.len(),
        mCapacity: v.capacity(),
    };
    std::mem::forget(v);
    w
}

#[inline]
fn view_byte_buf(b: &ByteBuf) -> &[u8] {
    if b.mData.is_null() {
        debug_assert_eq!(b.mCapacity, 0);
        return &[];
    }
    unsafe { std::slice::from_raw_parts(b.mData, b.mLen) }
}

macro_rules! impl_basic_serde_funcs {
    ($ser_name:ident, $de_name:ident, $computed_type:ty) => {
        #[no_mangle]
        pub extern "C" fn $ser_name(v: &$computed_type, output: &mut ByteBuf) -> bool {
            let buf = match serialize(v) {
                Ok(buf) => buf,
                Err(..) => return false,
            };

            *output = create_byte_buf_from_vec(buf);
            true
        }

        #[no_mangle]
        pub unsafe extern "C" fn $de_name(input: &ByteBuf, v: *mut $computed_type) -> bool {
            let buf = match deserialize(view_byte_buf(input)) {
                Ok(buf) => buf,
                Err(..) => return false,
            };

            std::ptr::write(v, buf);
            true
        }
    };
}

impl_basic_serde_funcs!(
    Servo_LengthPercentage_Serialize,
    Servo_LengthPercentage_Deserialize,
    computed::LengthPercentage
);

impl_basic_serde_funcs!(
    Servo_StyleRotate_Serialize,
    Servo_StyleRotate_Deserialize,
    computed::transform::Rotate
);

impl_basic_serde_funcs!(
    Servo_StyleScale_Serialize,
    Servo_StyleScale_Deserialize,
    computed::transform::Scale
);

impl_basic_serde_funcs!(
    Servo_StyleTranslate_Serialize,
    Servo_StyleTranslate_Deserialize,
    computed::transform::Translate
);

impl_basic_serde_funcs!(
    Servo_StyleTransform_Serialize,
    Servo_StyleTransform_Deserialize,
    computed::transform::Transform
);

impl_basic_serde_funcs!(
    Servo_StyleOffsetPath_Serialize,
    Servo_StyleOffsetPath_Deserialize,
    computed::motion::OffsetPath
);

impl_basic_serde_funcs!(
    Servo_StyleOffsetRotate_Serialize,
    Servo_StyleOffsetRotate_Deserialize,
    computed::motion::OffsetRotate
);

impl_basic_serde_funcs!(
    Servo_StylePositionOrAuto_Serialize,
    Servo_StylePositionOrAuto_Deserialize,
    computed::position::PositionOrAuto
);

impl_basic_serde_funcs!(
    Servo_StyleOffsetPosition_Serialize,
    Servo_StyleOffsetPosition_Deserialize,
    computed::motion::OffsetPosition
);

impl_basic_serde_funcs!(
    Servo_StyleComputedTimingFunction_Serialize,
    Servo_StyleComputedTimingFunction_Deserialize,
    ComputedTimingFunction
);

// Return the ComputedValues by a base ComputedValues and the rules.
fn resolve_rules_for_element_with_context<'a>(
    element: GeckoElement<'a>,
    mut context: StyleContext<GeckoElement<'a>>,
    rules: StrongRuleNode,
    original_computed_values: &ComputedValues,
) -> Arc<ComputedValues> {
    use style::style_resolver::{PseudoElementResolution, StyleResolverForElement};

    // This currently ignores visited styles, which seems acceptable, as
    // existing browsers don't appear to animate visited styles.
    let inputs = CascadeInputs {
        rules: Some(rules),
        visited_rules: None,
        flags: original_computed_values.flags.for_cascade_inputs(),
    };

    // Actually `PseudoElementResolution` doesn't matter.
    let mut resolver = StyleResolverForElement::new(
        element,
        &mut context,
        RuleInclusion::All,
        PseudoElementResolution::IfApplicable,
    );
    resolver
        .cascade_style_and_visited_with_default_parents(inputs)
        .0
}

#[no_mangle]
pub extern "C" fn Servo_AnimationValueMap_Create() -> *mut AnimationValueMap {
    Box::into_raw(Box::default())
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AnimationValueMap_Drop(value_map: *mut AnimationValueMap) {
    let _ = Box::from_raw(value_map);
}

#[no_mangle]
pub extern "C" fn Servo_AnimationValueMap_GetValue(
    value_map: &AnimationValueMap,
    property_id: &structs::AnimatedPropertyID,
) -> Strong<AnimationValue> {
    let property = match OwnedPropertyDeclarationId::from_gecko_animated_property_id(property_id) {
        Some(property) => property,
        None => return Strong::null(),
    };
    value_map
        .get(&property)
        .map_or(Strong::null(), |value| Arc::new(value.clone()).into())
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_GetBaseComputedValuesForElement(
    raw_style_set: &PerDocumentStyleData,
    element: &RawGeckoElement,
    computed_values: &ComputedValues,
    snapshots: *const ServoElementSnapshotTable,
) -> Strong<ComputedValues> {
    debug_assert!(!snapshots.is_null());
    let computed_values = unsafe { ArcBorrow::from_ref(computed_values) };

    let rules = match computed_values.rules {
        None => return computed_values.clone_arc().into(),
        Some(ref rules) => rules,
    };

    let doc_data = raw_style_set.borrow();
    let without_animations_rules = doc_data.stylist.rule_tree().remove_animation_rules(rules);
    if without_animations_rules == *rules {
        return computed_values.clone_arc().into();
    }

    let element = GeckoElement(element);

    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    let shared = create_shared_context(
        &global_style_data,
        &guard,
        &doc_data.stylist,
        TraversalFlags::empty(),
        unsafe { &*snapshots },
    );
    let mut tlc = ThreadLocalStyleContext::new();
    let context = StyleContext {
        shared: &shared,
        thread_local: &mut tlc,
    };

    resolve_rules_for_element_with_context(
        element,
        context,
        without_animations_rules,
        &computed_values,
    )
    .into()
}

#[repr(C)]
#[derive(Default)]
pub struct ShouldTransitionResult {
    should_animate: bool,
    old_transition_value_matches: bool,
}

#[inline]
fn is_transitionable(prop: PropertyDeclarationId, behavior: computed::TransitionBehavior) -> bool {
    if !prop.is_animatable() {
        return false;
    }
    // TODO(bug 1885995): Return `false` in is_discrete_animatable for interpolatable custom
    // property types.
    if matches!(prop, PropertyDeclarationId::Custom(..)) {
        return true;
    }

    match behavior {
        computed::TransitionBehavior::Normal => !prop.is_discrete_animatable(),
        // If transition-behavior is allow-discrete, transitionable is the same as animatable.
        computed::TransitionBehavior::AllowDiscrete => true,
    }
}

#[no_mangle]
pub extern "C" fn Servo_ComputedValues_ShouldTransition(
    old: &ComputedValues,
    new: &ComputedValues,
    prop: &structs::AnimatedPropertyID,
    behavior: computed::TransitionBehavior,
    old_transition_value: Option<&AnimationValue>,
    start: &mut structs::RefPtr<AnimationValue>,
    end: &mut structs::RefPtr<AnimationValue>,
) -> ShouldTransitionResult {
    let Some(prop) = OwnedPropertyDeclarationId::from_gecko_animated_property_id(prop) else {
        return Default::default();
    };
    let prop = prop.as_borrowed();
    if !is_transitionable(prop, behavior) {
        return Default::default();
    }

    let Some(new_value) = AnimationValue::from_computed_values(prop, new) else {
        return Default::default();
    };

    if let Some(old_transition_value) = old_transition_value {
        if *old_transition_value == new_value {
            return ShouldTransitionResult {
                should_animate: false,
                old_transition_value_matches: true,
            };
        }
    }

    let Some(old_value) = AnimationValue::from_computed_values(prop, old) else {
        return Default::default();
    };
    if old_value == new_value ||
        (matches!(behavior, computed::TransitionBehavior::Normal) &&
            !old_value.interpolable_with(&new_value))
    {
        return Default::default();
    }

    start.set_arc(Arc::new(old_value));
    end.set_arc(Arc::new(new_value));

    ShouldTransitionResult {
        should_animate: true,
        old_transition_value_matches: false,
    }
}

#[no_mangle]
pub extern "C" fn Servo_ComputedValues_TransitionValueMatches(
    style: &ComputedValues,
    prop: &structs::AnimatedPropertyID,
    transition_value: &AnimationValue,
) -> bool {
    let Some(prop) = OwnedPropertyDeclarationId::from_gecko_animated_property_id(prop) else {
        return false;
    };
    // Note: the running transitions should be transitionable, so it is always allow-discrete.
    let prop = prop.as_borrowed();
    if !is_transitionable(prop, computed::TransitionBehavior::AllowDiscrete) {
        return false;
    }
    let Some(value) = AnimationValue::from_computed_values(prop, style) else {
        return false;
    };
    value == *transition_value
}

#[no_mangle]
pub extern "C" fn Servo_ComputedValues_ExtractAnimationValue(
    computed_values: &ComputedValues,
    property_id: &structs::AnimatedPropertyID,
) -> Strong<AnimationValue> {
    let property = match OwnedPropertyDeclarationId::from_gecko_animated_property_id(property_id) {
        Some(property) => property,
        None => return Strong::null(),
    };
    match AnimationValue::from_computed_values(property.as_borrowed(), &computed_values) {
        Some(v) => Arc::new(v).into(),
        None => Strong::null(),
    }
}

#[no_mangle]
pub extern "C" fn Servo_ResolveLogicalProperty(
    property_id: nsCSSPropertyID,
    style: &ComputedValues,
) -> nsCSSPropertyID {
    let longhand = LonghandId::from_nscsspropertyid(property_id)
        .expect("We shouldn't need to care about shorthands");

    longhand
        .to_physical(style.writing_mode)
        .to_nscsspropertyid()
}

#[no_mangle]
pub unsafe extern "C" fn Servo_Property_LookupEnabledForAllContent(
    prop: &nsACString,
) -> nsCSSPropertyID {
    match PropertyId::parse_enabled_for_all_content(prop.as_str_unchecked()) {
        Ok(p) => p.to_nscsspropertyid_resolving_aliases(),
        Err(..) => nsCSSPropertyID::eCSSProperty_UNKNOWN,
    }
}

#[no_mangle]
pub unsafe extern "C" fn Servo_Property_GetName(
    prop: nsCSSPropertyID,
    out_length: *mut u32,
) -> *const u8 {
    let (ptr, len) = match NonCustomPropertyId::from_nscsspropertyid(prop) {
        Some(p) => {
            let name = p.name();
            (name.as_bytes().as_ptr(), name.len())
        },
        None => (ptr::null(), 0),
    };

    *out_length = len as u32;
    ptr
}

macro_rules! parse_enabled_property_name {
    ($prop_name:ident, $found:ident, $default:expr) => {{
        let prop_name = $prop_name.as_str_unchecked();
        match PropertyId::parse_enabled_for_all_content(prop_name) {
            Ok(p) => {
                *$found = true;
                p
            },
            Err(..) => {
                *$found = false;
                return $default;
            },
        }
    }};
}

#[no_mangle]
pub unsafe extern "C" fn Servo_Property_IsShorthand(
    prop_name: &nsACString,
    found: *mut bool,
) -> bool {
    let prop_id = parse_enabled_property_name!(prop_name, found, false);
    prop_id.is_shorthand()
}

#[no_mangle]
pub unsafe extern "C" fn Servo_Property_IsInherited(
    per_doc_data: &PerDocumentStyleData,
    prop_name: &nsACString,
) -> bool {
    let prop_name = prop_name.as_str_unchecked();
    let prop_id = match PropertyId::parse_enabled_for_all_content(prop_name) {
        Ok(id) => id,
        Err(_) => return false,
    };
    let longhand_id = match prop_id {
        PropertyId::Custom(property_name) => {
            let stylist = &per_doc_data.borrow().stylist;
            return stylist
                .get_custom_property_registration(&property_name)
                .inherits();
        },
        PropertyId::NonCustom(id) => match id.longhand_or_shorthand() {
            Ok(lh) => lh,
            Err(sh) => sh.longhands().next().unwrap(),
        },
    };
    longhand_id.inherited()
}

#[no_mangle]
pub unsafe extern "C" fn Servo_Property_SupportsType(
    prop_name: &nsACString,
    ty: u8,
    found: *mut bool,
) -> bool {
    let prop_id = parse_enabled_property_name!(prop_name, found, false);
    prop_id.supports_type(ty)
}

#[no_mangle]
pub unsafe extern "C" fn Servo_Property_GetCSSValuesForProperty(
    prop_name: &nsACString,
    found: *mut bool,
    result: &mut nsTArray<nsString>,
) {
    let prop_id = parse_enabled_property_name!(prop_name, found, ());
    // Use B-tree set for unique and sorted result.
    let mut values = BTreeSet::<&'static str>::new();
    prop_id.collect_property_completion_keywords(&mut |list| values.extend(list.iter()));

    if values.contains("transparent") {
        // This is a special value devtools use to avoid inserting the
        // long list of color keywords. We need to prepend it to values.
        result.push("COLOR".into());
    }

    for value in values {
        result.push(value.into());
    }
}

#[no_mangle]
pub extern "C" fn Servo_Property_IsAnimatable(prop: &structs::AnimatedPropertyID) -> bool {
    PropertyId::from_gecko_animated_property_id(prop).map_or(false, |p| p.is_animatable())
}

#[no_mangle]
pub extern "C" fn Servo_Property_IsDiscreteAnimatable(property: nsCSSPropertyID) -> bool {
    match LonghandId::from_nscsspropertyid(property) {
        Some(longhand) => longhand.is_discrete_animatable(),
        None => return false,
    }
}

#[no_mangle]
pub extern "C" fn Servo_Element_ClearData(element: &RawGeckoElement) {
    unsafe { GeckoElement(element).clear_data() };
}

#[no_mangle]
pub extern "C" fn Servo_Element_SizeOfExcludingThisAndCVs(
    malloc_size_of: GeckoMallocSizeOf,
    malloc_enclosing_size_of: GeckoMallocSizeOf,
    seen_ptrs: *mut SeenPtrs,
    element: &RawGeckoElement,
) -> usize {
    let element = GeckoElement(element);
    let borrow = element.borrow_data();
    if let Some(data) = borrow {
        let have_seen_ptr = move |ptr| unsafe { Gecko_HaveSeenPtr(seen_ptrs, ptr) };
        let mut ops = MallocSizeOfOps::new(
            malloc_size_of.unwrap(),
            Some(malloc_enclosing_size_of.unwrap()),
            Some(Box::new(have_seen_ptr)),
        );
        (*data).size_of_excluding_cvs(&mut ops)
    } else {
        0
    }
}

#[no_mangle]
pub extern "C" fn Servo_Element_GetMaybeOutOfDateStyle(
    element: &RawGeckoElement,
) -> *const ComputedValues {
    let element = GeckoElement(element);
    let data = match element.borrow_data() {
        Some(d) => d,
        None => return ptr::null(),
    };
    &**data.styles.primary() as *const _
}

#[no_mangle]
pub extern "C" fn Servo_Element_GetMaybeOutOfDatePseudoStyle(
    element: &RawGeckoElement,
    index: usize,
) -> *const ComputedValues {
    let element = GeckoElement(element);
    let data = match element.borrow_data() {
        Some(d) => d,
        None => return ptr::null(),
    };
    match data.styles.pseudos.as_array()[index].as_ref() {
        Some(style) => &**style as *const _,
        None => ptr::null(),
    }
}

// Some functions are so hot and main-thread-only that we have to bypass the AtomicRefCell.
//
// It would be nice to also assert that we're not in the servo traversal, but this function is
// called at various intermediate checkpoints when managing the traversal on the Gecko side.
#[cfg(debug_assertions)]
unsafe fn borrow_assert_main_thread<T>(cell: &atomic_refcell::AtomicRefCell<T>) -> atomic_refcell::AtomicRef<T> {
    debug_assert!(is_main_thread());
    cell.borrow()
}

#[cfg(not(debug_assertions))]
unsafe fn borrow_assert_main_thread<T>(cell: &atomic_refcell::AtomicRefCell<T>) -> &T {
    unsafe { &*cell.as_ptr() }
}

#[no_mangle]
pub extern "C" fn Servo_Element_IsDisplayNone(element: &RawGeckoElement) -> bool {
    let element = GeckoElement(element);
    let data = element
        .get_data()
        .expect("Invoking Servo_Element_IsDisplayNone on unstyled element");

    let is_display_none = unsafe { borrow_assert_main_thread(data) }
        .styles
        .is_display_none();
    is_display_none
}

#[no_mangle]
pub extern "C" fn Servo_Element_IsDisplayContents(element: &RawGeckoElement) -> bool {
    let element = GeckoElement(element);
    let data = element
        .get_data()
        .expect("Invoking Servo_Element_IsDisplayContents on unstyled element");

    let is_display_contents = unsafe { borrow_assert_main_thread(data) }
        .styles
        .primary()
        .get_box()
        .clone_display()
        .is_contents();
    is_display_contents
}

#[no_mangle]
pub extern "C" fn Servo_Element_IsPrimaryStyleReusedViaRuleNode(element: &RawGeckoElement) -> bool {
    let element = GeckoElement(element);
    let data = element
        .borrow_data()
        .expect("Invoking Servo_Element_IsPrimaryStyleReusedViaRuleNode on unstyled element");
    data.flags
        .contains(data::ElementDataFlags::PRIMARY_STYLE_REUSED_VIA_RULE_NODE)
}

#[no_mangle]
pub extern "C" fn Servo_Element_MayHaveStartingStyle(element: &RawGeckoElement) -> bool {
    let element = GeckoElement(element);
    let data = match element.borrow_data() {
        Some(d) => d,
        None => return false,
    };
    data.flags
        .contains(data::ElementDataFlags::MAY_HAVE_STARTING_STYLE)
}

fn mode_to_origin(mode: SheetParsingMode) -> Origin {
    match mode {
        SheetParsingMode::eAuthorSheetFeatures => Origin::Author,
        SheetParsingMode::eUserSheetFeatures => Origin::User,
        SheetParsingMode::eAgentSheetFeatures => Origin::UserAgent,
    }
}

#[no_mangle]
pub extern "C" fn Servo_StyleSheet_Empty(mode: SheetParsingMode) -> Strong<StylesheetContents> {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let origin = mode_to_origin(mode);
    let shared_lock = &global_style_data.shared_lock;
    StylesheetContents::from_str(
        "",
        unsafe { dummy_url_data() }.clone(),
        origin,
        shared_lock,
        /* loader = */ None,
        None,
        QuirksMode::NoQuirks,
        /* use_counters = */ None,
        AllowImportRules::Yes,
        /* sanitization_data = */ None,
    )
    .into()
}

/// Note: The load_data corresponds to this sheet, and is passed as the parent
/// load data for child sheet loads. It may be null for certain cases where we
/// know we won't have child loads.
#[no_mangle]
pub unsafe extern "C" fn Servo_StyleSheet_FromUTF8Bytes(
    loader: *mut Loader,
    stylesheet: *mut DomStyleSheet,
    load_data: *mut SheetLoadData,
    bytes: &nsACString,
    mode: SheetParsingMode,
    extra_data: *mut URLExtraData,
    quirks_mode: nsCompatibility,
    reusable_sheets: *mut LoaderReusableStyleSheets,
    use_counters: Option<&UseCounters>,
    allow_import_rules: AllowImportRules,
    sanitization_kind: SanitizationKind,
    sanitized_output: Option<&mut nsAString>,
) -> Strong<StylesheetContents> {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let input = bytes.as_str_unchecked();

    let reporter = ErrorReporter::new(stylesheet, loader, extra_data);
    let url_data = UrlExtraData::from_ptr_ref(&extra_data);
    let loader = if loader.is_null() {
        None
    } else {
        debug_assert!(
            sanitized_output.is_none(),
            "Shouldn't trigger @import loads for sanitization",
        );
        Some(StylesheetLoader::new(
            loader,
            stylesheet,
            load_data,
            reusable_sheets,
        ))
    };

    // FIXME(emilio): loader.as_ref() doesn't typecheck for some reason?
    let loader: Option<&dyn StyleStylesheetLoader> = match loader {
        None => None,
        Some(ref s) => Some(s),
    };

    let mut sanitization_data = SanitizationData::new(sanitization_kind);

    let contents = StylesheetContents::from_str(
        input,
        url_data.clone(),
        mode_to_origin(mode),
        &global_style_data.shared_lock,
        loader,
        reporter.as_ref().map(|r| r as &dyn ParseErrorReporter),
        quirks_mode.into(),
        use_counters,
        allow_import_rules,
        sanitization_data.as_mut(),
    );

    if let Some(data) = sanitization_data {
        sanitized_output
            .unwrap()
            .assign_utf8(data.take().as_bytes());
    }

    contents.into()
}

#[no_mangle]
pub unsafe extern "C" fn Servo_StyleSheet_FromUTF8BytesAsync(
    load_data: *mut SheetLoadDataHolder,
    extra_data: *mut URLExtraData,
    bytes: &nsACString,
    mode: SheetParsingMode,
    quirks_mode: nsCompatibility,
    should_record_use_counters: bool,
    allow_import_rules: AllowImportRules,
) {
    let load_data = RefPtr::new(load_data);
    let extra_data = UrlExtraData::new(extra_data);

    let mut sheet_bytes = nsCString::new();
    sheet_bytes.assign(bytes);

    let async_parser = AsyncStylesheetParser::new(
        load_data,
        extra_data,
        sheet_bytes,
        mode_to_origin(mode),
        quirks_mode.into(),
        should_record_use_counters,
        allow_import_rules,
    );

    if let Some(thread_pool) = STYLE_THREAD_POOL.pool().as_ref() {
        thread_pool.spawn(|| {
            gecko_profiler_label!(Layout, CSSParsing);
            async_parser.parse();
        });
    } else {
        async_parser.parse();
    }
}

#[no_mangle]
pub unsafe extern "C" fn Servo_ShutdownThreadPool() {
    debug_assert!(is_main_thread() && !is_in_servo_traversal());
    StyleThreadPool::shutdown();
}

#[no_mangle]
pub unsafe extern "C" fn Servo_ThreadPool_GetThreadHandles(
    handles: &mut nsTArray<PlatformThreadHandle>,
) {
    StyleThreadPool::get_thread_handles(handles);
}

#[no_mangle]
pub unsafe extern "C" fn Servo_StyleSheet_FromSharedData(
    extra_data: *mut URLExtraData,
    shared_rules: &LockedCssRules,
) -> Strong<StylesheetContents> {
    StylesheetContents::from_shared_data(
        Arc::from_raw_addrefed(shared_rules),
        Origin::UserAgent,
        UrlExtraData::new(extra_data),
        QuirksMode::NoQuirks,
    )
    .into()
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_AppendStyleSheet(
    raw_data: &PerDocumentStyleData,
    sheet: *const DomStyleSheet,
) {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let mut data = raw_data.borrow_mut();
    let data = &mut *data;
    let guard = global_style_data.shared_lock.read();
    let sheet = unsafe { GeckoStyleSheet::new(sheet) };
    data.stylist.append_stylesheet(sheet, &guard);
}

#[no_mangle]
pub extern "C" fn Servo_AuthorStyles_Create() -> *mut AuthorStyles {
    Box::into_raw(Box::new(AuthorStyles::new()))
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AuthorStyles_Drop(styles: *mut AuthorStyles) {
    let _ = Box::from_raw(styles);
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AuthorStyles_AppendStyleSheet(
    styles: &mut AuthorStyles,
    sheet: *const DomStyleSheet,
) {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    let sheet = GeckoStyleSheet::new(sheet);
    styles.stylesheets.append_stylesheet(None, sheet, &guard);
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AuthorStyles_InsertStyleSheetBefore(
    styles: &mut AuthorStyles,
    sheet: *const DomStyleSheet,
    before_sheet: *const DomStyleSheet,
) {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    styles.stylesheets.insert_stylesheet_before(
        None,
        GeckoStyleSheet::new(sheet),
        GeckoStyleSheet::new(before_sheet),
        &guard,
    );
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AuthorStyles_RemoveStyleSheet(
    styles: &mut AuthorStyles,
    sheet: *const DomStyleSheet,
) {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    styles
        .stylesheets
        .remove_stylesheet(None, GeckoStyleSheet::new(sheet), &guard);
}

#[no_mangle]
pub extern "C" fn Servo_AuthorStyles_ForceDirty(styles: &mut AuthorStyles) {
    styles.stylesheets.force_dirty();
}

#[no_mangle]
pub extern "C" fn Servo_AuthorStyles_IsDirty(styles: &AuthorStyles) -> bool {
    styles.stylesheets.dirty()
}

#[no_mangle]
pub extern "C" fn Servo_AuthorStyles_Flush(
    styles: &mut AuthorStyles,
    document_set: &PerDocumentStyleData,
) {
    // Try to avoid the atomic borrow below if possible.
    if !styles.stylesheets.dirty() {
        return;
    }

    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();

    let mut document_data = document_set.borrow_mut();

    // TODO(emilio): This is going to need an element or something to do proper
    // invalidation in Shadow roots.
    styles.flush::<GeckoElement>(&mut document_data.stylist, &guard);
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_RemoveUniqueEntriesFromAuthorStylesCache(
    document_set: &PerDocumentStyleData,
) {
    let mut document_data = document_set.borrow_mut();
    document_data
        .stylist
        .remove_unique_author_data_cache_entries();
}

#[no_mangle]
pub unsafe extern "C" fn Servo_DeclarationBlock_SizeOfIncludingThis(
    malloc_size_of: GeckoMallocSizeOf,
    malloc_enclosing_size_of: GeckoMallocSizeOf,
    declarations: &LockedDeclarationBlock,
) -> usize {
    use malloc_size_of::MallocSizeOf;
    use malloc_size_of::MallocUnconditionalShallowSizeOf;

    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();

    let mut ops = MallocSizeOfOps::new(
        malloc_size_of.unwrap(),
        Some(malloc_enclosing_size_of.unwrap()),
        None,
    );

    ArcBorrow::from_ref(declarations).with_arc(|declarations| {
        let mut n = 0;
        n += declarations.unconditional_shallow_size_of(&mut ops);
        n += declarations.read_with(&guard).size_of(&mut ops);
        n
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_AuthorStyles_SizeOfIncludingThis(
    malloc_size_of: GeckoMallocSizeOf,
    malloc_enclosing_size_of: GeckoMallocSizeOf,
    styles: &AuthorStyles,
) -> usize {
    // We cannot `use` MallocSizeOf at the top level, otherwise the compiler
    // would complain in `Servo_StyleSheet_SizeOfIncludingThis` for `size_of`
    // there.
    use malloc_size_of::MallocSizeOf;
    let malloc_size_of = malloc_size_of.unwrap();
    let malloc_size_of_this = malloc_size_of(styles as *const AuthorStyles as *const c_void);

    let mut ops = MallocSizeOfOps::new(
        malloc_size_of,
        Some(malloc_enclosing_size_of.unwrap()),
        None,
    );
    malloc_size_of_this + styles.size_of(&mut ops)
}

#[no_mangle]
pub unsafe extern "C" fn Servo_StyleSet_MediumFeaturesChanged(
    document_set: &PerDocumentStyleData,
    non_document_styles: &mut nsTArray<&mut AuthorStyles>,
    may_affect_default_style: bool,
) -> structs::MediumFeaturesChangedResult {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();

    // NOTE(emilio): We don't actually need to flush the stylist here and ensure
    // it's up to date.
    //
    // In case it isn't we would trigger a rebuild + restyle as needed too.
    //
    // We need to ensure the default computed values are up to date though,
    // because those can influence the result of media query evaluation.
    let mut document_data = document_set.borrow_mut();

    if may_affect_default_style {
        document_data.stylist.device_mut().reset_computed_values();
    }
    let guards = StylesheetGuards::same(&guard);

    let origins_in_which_rules_changed = document_data
        .stylist
        .media_features_change_changed_style(&guards, document_data.stylist.device());

    let affects_document_rules = !origins_in_which_rules_changed.is_empty();
    if affects_document_rules {
        document_data
            .stylist
            .force_stylesheet_origins_dirty(origins_in_which_rules_changed);
    }

    let mut affects_non_document_rules = false;
    for author_styles in &mut **non_document_styles {
        let affected_style = author_styles.stylesheets.iter().any(|sheet| {
            !author_styles.data.media_feature_affected_matches(
                sheet,
                &guards.author,
                document_data.stylist.device(),
                document_data.stylist.quirks_mode(),
            )
        });
        if affected_style {
            affects_non_document_rules = true;
            author_styles.stylesheets.force_dirty();
        }
    }

    structs::MediumFeaturesChangedResult {
        mAffectsDocumentRules: affects_document_rules,
        mAffectsNonDocumentRules: affects_non_document_rules,
    }
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_InsertStyleSheetBefore(
    raw_data: &PerDocumentStyleData,
    sheet: *const DomStyleSheet,
    before_sheet: *const DomStyleSheet,
) {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let mut data = raw_data.borrow_mut();
    let data = &mut *data;
    let guard = global_style_data.shared_lock.read();
    let sheet = unsafe { GeckoStyleSheet::new(sheet) };
    data.stylist.insert_stylesheet_before(
        sheet,
        unsafe { GeckoStyleSheet::new(before_sheet) },
        &guard,
    );
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_RemoveStyleSheet(
    raw_data: &PerDocumentStyleData,
    sheet: *const DomStyleSheet,
) {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let mut data = raw_data.borrow_mut();
    let data = &mut *data;
    let guard = global_style_data.shared_lock.read();
    let sheet = unsafe { GeckoStyleSheet::new(sheet) };
    data.stylist.remove_stylesheet(sheet, &guard);
}

#[no_mangle]
pub unsafe extern "C" fn Servo_StyleSet_GetSheetAt(
    raw_data: &PerDocumentStyleData,
    origin: Origin,
    index: usize,
) -> *const DomStyleSheet {
    let data = raw_data.borrow();
    data.stylist
        .sheet_at(origin, index)
        .map_or(ptr::null(), |s| s.raw())
}

#[no_mangle]
pub unsafe extern "C" fn Servo_StyleSet_GetSheetCount(
    raw_data: &PerDocumentStyleData,
    origin: Origin,
) -> usize {
    let data = raw_data.borrow();
    data.stylist.sheet_count(origin)
}

#[no_mangle]
pub unsafe extern "C" fn Servo_StyleSet_FlushStyleSheets(
    raw_data: &PerDocumentStyleData,
    doc_element: Option<&RawGeckoElement>,
    snapshots: *const ServoElementSnapshotTable,
) {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    let mut data = raw_data.borrow_mut();
    let doc_element = doc_element.map(GeckoElement);

    let have_invalidations = data.flush_stylesheets(&guard, doc_element, snapshots.as_ref());

    if have_invalidations && doc_element.is_some() {
        // The invalidation machinery propagates the bits up, but we still need
        // to tell the Gecko restyle root machinery about it.
        bindings::Gecko_NoteDirtySubtreeForInvalidation(doc_element.unwrap().0);
    }
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_NoteStyleSheetsChanged(
    raw_data: &PerDocumentStyleData,
    changed_origins: OriginFlags,
) {
    let mut data = raw_data.borrow_mut();
    data.stylist
        .force_stylesheet_origins_dirty(OriginSet::from(changed_origins));
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_SetAuthorStyleDisabled(
    raw_data: &PerDocumentStyleData,
    author_style_disabled: bool,
) {
    let mut data = raw_data.borrow_mut();
    let enabled = if author_style_disabled {
        AuthorStylesEnabled::No
    } else {
        AuthorStylesEnabled::Yes
    };
    data.stylist.set_author_styles_enabled(enabled);
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_UsesFontMetrics(raw_data: &PerDocumentStyleData) -> bool {
    let doc_data = raw_data;
    doc_data.borrow().stylist.device().used_font_metrics()
}

#[no_mangle]
pub extern "C" fn Servo_StyleSheet_HasRules(raw_contents: &StylesheetContents) -> bool {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    !raw_contents.rules.read_with(&guard).0.is_empty()
}

#[no_mangle]
pub extern "C" fn Servo_StyleSheet_GetRules(sheet: &StylesheetContents) -> Strong<LockedCssRules> {
    sheet.rules.clone().into()
}

#[no_mangle]
pub extern "C" fn Servo_StyleSheet_Clone(
    contents: &StylesheetContents,
    reference_sheet: *const DomStyleSheet,
) -> Strong<StylesheetContents> {
    use style::shared_lock::{DeepCloneParams, DeepCloneWithLock};
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    let params = DeepCloneParams { reference_sheet };

    Arc::new(contents.deep_clone_with_lock(&global_style_data.shared_lock, &guard, &params)).into()
}

#[no_mangle]
pub extern "C" fn Servo_StyleSheet_SizeOfIncludingThis(
    malloc_size_of: GeckoMallocSizeOf,
    malloc_enclosing_size_of: GeckoMallocSizeOf,
    sheet: &StylesheetContents,
) -> usize {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    let mut ops = MallocSizeOfOps::new(
        malloc_size_of.unwrap(),
        Some(malloc_enclosing_size_of.unwrap()),
        None,
    );
    // TODO(emilio): We're not measuring the size of the Arc<StylesheetContents>
    // allocation itself here.
    sheet.size_of(&guard, &mut ops)
}

#[no_mangle]
pub extern "C" fn Servo_StyleSheet_GetOrigin(sheet: &StylesheetContents) -> Origin {
    sheet.origin
}

#[no_mangle]
pub extern "C" fn Servo_StyleSheet_GetSourceMapURL(
    contents: &StylesheetContents,
    result: &mut nsACString,
) {
    let url_opt = contents.source_map_url.read();
    if let Some(ref url) = *url_opt {
        result.assign(url);
    }
}

#[no_mangle]
pub extern "C" fn Servo_StyleSheet_GetSourceURL(
    contents: &StylesheetContents,
    result: &mut nsACString,
) {
    let url_opt = contents.source_url.read();
    if let Some(ref url) = *url_opt {
        result.assign(url);
    }
}

fn with_maybe_worker_shared_lock<R>(func: impl FnOnce(&SharedRwLock) -> R) -> R {
    if is_dom_worker_thread() {
        DOM_WORKER_RWLOCK.with(func)
    } else {
        func(&GLOBAL_STYLE_DATA.shared_lock)
    }
}

fn read_locked_arc<T, R, F>(raw: &Locked<T>, func: F) -> R
where
    F: FnOnce(&T) -> R,
{
    debug_assert!(!is_dom_worker_thread());
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    func(raw.read_with(&guard))
}

fn read_locked_arc_worker<T, R, F>(raw: &Locked<T>, func: F) -> R
where
    F: FnOnce(&T) -> R,
{
    with_maybe_worker_shared_lock(|lock| {
        let guard = lock.read();
        func(raw.read_with(&guard))
    })
}

#[cfg(debug_assertions)]
unsafe fn read_locked_arc_unchecked<T, R, F>(raw: &Locked<T>, func: F) -> R
where
    F: FnOnce(&T) -> R,
{
    debug_assert!(is_main_thread() && !is_in_servo_traversal());
    read_locked_arc(raw, func)
}

#[cfg(not(debug_assertions))]
unsafe fn read_locked_arc_unchecked<T, R, F>(raw: &Locked<T>, func: F) -> R
where
    F: FnOnce(&T) -> R,
{
    debug_assert!(!is_dom_worker_thread());
    func(raw.read_unchecked())
}

fn write_locked_arc<T, R, F>(raw: &Locked<T>, func: F) -> R
where
    F: FnOnce(&mut T) -> R,
{
    debug_assert!(!is_dom_worker_thread());
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let mut guard = global_style_data.shared_lock.write();
    func(raw.write_with(&mut guard))
}

fn write_locked_arc_worker<T, R, F>(raw: &Locked<T>, func: F) -> R
where
    F: FnOnce(&mut T) -> R,
{
    with_maybe_worker_shared_lock(|lock| {
        let mut guard = lock.write();
        func(raw.write_with(&mut guard))
    })
}

#[no_mangle]
pub extern "C" fn Servo_CssRules_ListTypes(rules: &LockedCssRules, result: &mut nsTArray<usize>) {
    read_locked_arc(rules, |rules: &CssRules| {
        result.extend(rules.0.iter().map(|rule| rule.rule_type() as usize));
    })
}

#[no_mangle]
pub extern "C" fn Servo_CssRules_InsertRule(
    rules: &LockedCssRules,
    contents: &StylesheetContents,
    rule: &nsACString,
    index: u32,
    containing_rule_types: u32,
    parse_relative_rule_type: Option<&CssRuleType>,
    loader: *mut Loader,
    allow_import_rules: AllowImportRules,
    gecko_stylesheet: *mut DomStyleSheet,
    rule_type: &mut CssRuleType,
) -> nsresult {
    let loader = if loader.is_null() {
        None
    } else {
        Some(StylesheetLoader::new(
            loader,
            gecko_stylesheet,
            ptr::null_mut(),
            ptr::null_mut(),
        ))
    };
    let loader = loader
        .as_ref()
        .map(|loader| loader as &dyn StyleStylesheetLoader);
    let rule = unsafe { rule.as_str_unchecked() };

    let global_style_data = &*GLOBAL_STYLE_DATA;
    let result = rules.insert_rule(
        &global_style_data.shared_lock,
        rule,
        contents,
        index as usize,
        CssRuleTypes::from_bits(containing_rule_types),
        parse_relative_rule_type.cloned(),
        loader,
        allow_import_rules,
    );

    match result {
        Ok(new_rule) => {
            *rule_type = new_rule.rule_type();
            nsresult::NS_OK
        },
        Err(err) => err.into(),
    }
}

#[no_mangle]
pub extern "C" fn Servo_CssRules_DeleteRule(rules: &LockedCssRules, index: u32) -> nsresult {
    write_locked_arc(rules, |rules: &mut CssRules| {
        match rules.remove_rule(index as usize) {
            Ok(_) => nsresult::NS_OK,
            Err(err) => err.into(),
        }
    })
}

trait MaybeLocked<Target> {
    fn maybe_locked_read<'a>(&'a self, guard: &'a SharedRwLockReadGuard) -> &'a Target;
}

impl<T> MaybeLocked<T> for T {
    fn maybe_locked_read<'a>(&'a self, _: &'a SharedRwLockReadGuard) -> &'a T {
        self
    }
}

impl<T> MaybeLocked<T> for Locked<T> {
    fn maybe_locked_read<'a>(&'a self, guard: &'a SharedRwLockReadGuard) -> &'a T {
        self.read_with(guard)
    }
}

macro_rules! impl_basic_rule_funcs_without_getter {
    {
        ($rule_type:ty, $maybe_locked_rule_type:ty),
        debug: $debug:ident,
        to_css: $to_css:ident,
    } => {
        #[cfg(debug_assertions)]
        #[no_mangle]
        pub extern "C" fn $debug(rule: &$maybe_locked_rule_type, result: &mut nsACString) {
            let global_style_data = &*GLOBAL_STYLE_DATA;
            let guard = global_style_data.shared_lock.read();
            let rule: &$rule_type = rule.maybe_locked_read(&guard);
            write!(result, "{:?}", *rule).unwrap();
        }

        #[cfg(not(debug_assertions))]
        #[no_mangle]
        pub extern "C" fn $debug(_: &$maybe_locked_rule_type, _: &mut nsACString) {
            unreachable!()
        }

        #[no_mangle]
        pub extern "C" fn $to_css(rule: &$maybe_locked_rule_type, result: &mut nsACString) {
            let global_style_data = &*GLOBAL_STYLE_DATA;
            let guard = global_style_data.shared_lock.read();
            let rule: &$rule_type = rule.maybe_locked_read(&guard);
            rule.to_css(&guard, result).unwrap();
        }
    }
}

macro_rules! impl_basic_rule_funcs {
    { ($name:ident, $rule_type:ty, $maybe_locked_rule_type:ty),
        getter: $getter:ident,
        debug: $debug:ident,
        to_css: $to_css:ident,
        changed: $changed:ident,
    } => {
        #[no_mangle]
        pub extern "C" fn $getter(
            rules: &LockedCssRules,
            index: u32,
            line: &mut u32,
            column: &mut u32,
        ) -> Strong<$maybe_locked_rule_type> {
            let global_style_data = &*GLOBAL_STYLE_DATA;
            let guard = global_style_data.shared_lock.read();
            let rules = rules.read_with(&guard);
            let index = index as usize;

            if index >= rules.0.len() {
                return Strong::null();
            }

            match rules.0[index] {
                CssRule::$name(ref arc) => {
                    let rule: &$rule_type = (&**arc).maybe_locked_read(&guard);
                    let location = rule.source_location;
                    *line = location.line as u32;
                    *column = location.column as u32;
                    arc.clone().into()
                },
                _ => {
                    Strong::null()
                }
            }
        }

        #[no_mangle]
        pub extern "C" fn $changed(
            styleset: &PerDocumentStyleData,
            rule: &$maybe_locked_rule_type,
            sheet: &DomStyleSheet,
            change_kind: RuleChangeKind,
        ) {
            let mut data = styleset.borrow_mut();
            let data = &mut *data;
            let global_style_data = &*GLOBAL_STYLE_DATA;
            let guard = global_style_data.shared_lock.read();
            // TODO(emilio): Would be nice not to deal with refcount bumps here,
            // but it's probably not a huge deal.
            let rule = unsafe { CssRule::$name(Arc::from_raw_addrefed(rule)) };
            let sheet = unsafe { GeckoStyleSheet::new(sheet) };
            data.stylist.rule_changed(&sheet, &rule, &guard, change_kind);
        }

        impl_basic_rule_funcs_without_getter! {
            ($rule_type, $maybe_locked_rule_type),
            debug: $debug,
            to_css: $to_css,
        }
    }
}

macro_rules! impl_group_rule_funcs {
    { ($name:ident, $rule_type:ty, $maybe_locked_rule_type:ty),
      get_rules: $get_rules:ident,
      $($basic:tt)+
    } => {
        impl_basic_rule_funcs! { ($name, $rule_type, $maybe_locked_rule_type), $($basic)+ }

        #[no_mangle]
        pub extern "C" fn $get_rules(rule: &$maybe_locked_rule_type) -> Strong<LockedCssRules> {
            let global_style_data = &*GLOBAL_STYLE_DATA;
            let guard = global_style_data.shared_lock.read();
            let rule: &$rule_type = rule.maybe_locked_read(&guard);
            rule.rules.clone().into()
        }
    }
}

impl_basic_rule_funcs! { (Style, StyleRule, Locked<StyleRule>),
    getter: Servo_CssRules_GetStyleRuleAt,
    debug: Servo_StyleRule_Debug,
    to_css: Servo_StyleRule_GetCssText,
    changed: Servo_StyleSet_StyleRuleChanged,
}

#[no_mangle]
pub extern "C" fn Servo_StyleRule_EnsureRules(
    rule: &LockedStyleRule,
    read_only: bool,
) -> Strong<LockedCssRules> {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let lock = &global_style_data.shared_lock;
    if read_only {
        let guard = lock.read();
        if let Some(ref rules) = rule.read_with(&guard).rules {
            return rules.clone().into();
        }
        return CssRules::new(vec![], lock).into();
    }
    let mut guard = lock.write();
    rule.write_with(&mut guard)
        .rules
        .get_or_insert_with(|| CssRules::new(vec![], lock))
        .clone()
        .into()
}

impl_basic_rule_funcs! { (Import, ImportRule, Locked<ImportRule>),
    getter: Servo_CssRules_GetImportRuleAt,
    debug: Servo_ImportRule_Debug,
    to_css: Servo_ImportRule_GetCssText,
    changed: Servo_StyleSet_ImportRuleChanged,
}

impl_basic_rule_funcs_without_getter! { (Keyframe, Locked<Keyframe>),
    debug: Servo_Keyframe_Debug,
    to_css: Servo_Keyframe_GetCssText,
}

impl_basic_rule_funcs! { (Keyframes, KeyframesRule, Locked<KeyframesRule>),
    getter: Servo_CssRules_GetKeyframesRuleAt,
    debug: Servo_KeyframesRule_Debug,
    to_css: Servo_KeyframesRule_GetCssText,
    changed: Servo_StyleSet_KeyframesRuleChanged,
}

impl_group_rule_funcs! { (Media, MediaRule, MediaRule),
    get_rules: Servo_MediaRule_GetRules,
    getter: Servo_CssRules_GetMediaRuleAt,
    debug: Servo_MediaRule_Debug,
    to_css: Servo_MediaRule_GetCssText,
    changed: Servo_StyleSet_MediaRuleChanged,
}

impl_basic_rule_funcs! { (Margin, MarginRule, MarginRule),
    getter: Servo_CssRules_GetMarginRuleAt,
    debug: Servo_MarginRule_Debug,
    to_css: Servo_MarginRule_GetCssText,
    changed: Servo_StyleSet_MarginRuleChanged,
}

impl_basic_rule_funcs! { (Namespace, NamespaceRule, NamespaceRule),
    getter: Servo_CssRules_GetNamespaceRuleAt,
    debug: Servo_NamespaceRule_Debug,
    to_css: Servo_NamespaceRule_GetCssText,
    changed: Servo_StyleSet_NamespaceRuleChanged,
}

impl_group_rule_funcs! { (Page, PageRule, Locked<PageRule>),
    get_rules: Servo_PageRule_GetRules,
    getter: Servo_CssRules_GetPageRuleAt,
    debug: Servo_PageRule_Debug,
    to_css: Servo_PageRule_GetCssText,
    changed: Servo_StyleSet_PageRuleChanged,
}

impl_basic_rule_funcs! { (Property, PropertyRule, PropertyRule),
    getter: Servo_CssRules_GetPropertyRuleAt,
    debug: Servo_PropertyRule_Debug,
    to_css: Servo_PropertyRule_GetCssText,
    changed: Servo_StyleSet_PropertyRuleChanged,
}

impl_group_rule_funcs! { (Supports, SupportsRule, SupportsRule),
    get_rules: Servo_SupportsRule_GetRules,
    getter: Servo_CssRules_GetSupportsRuleAt,
    debug: Servo_SupportsRule_Debug,
    to_css: Servo_SupportsRule_GetCssText,
    changed: Servo_StyleSet_SupportsRuleChanged,
}

impl_group_rule_funcs! { (Container, ContainerRule, ContainerRule),
    get_rules: Servo_ContainerRule_GetRules,
    getter: Servo_CssRules_GetContainerRuleAt,
    debug: Servo_ContainerRule_Debug,
    to_css: Servo_ContainerRule_GetCssText,
    changed: Servo_StyleSet_ContainerRuleChanged,
}

impl_group_rule_funcs! { (LayerBlock, LayerBlockRule, LayerBlockRule),
    get_rules: Servo_LayerBlockRule_GetRules,
    getter: Servo_CssRules_GetLayerBlockRuleAt,
    debug: Servo_LayerBlockRule_Debug,
    to_css: Servo_LayerBlockRule_GetCssText,
    changed: Servo_StyleSet_LayerBlockRuleChanged,
}

impl_basic_rule_funcs! { (LayerStatement, LayerStatementRule, LayerStatementRule),
    getter: Servo_CssRules_GetLayerStatementRuleAt,
    debug: Servo_LayerStatementRule_Debug,
    to_css: Servo_LayerStatementRule_GetCssText,
    changed: Servo_StyleSet_LayerStatementRuleChanged,
}

impl_group_rule_funcs! { (Document, DocumentRule, DocumentRule),
    get_rules: Servo_DocumentRule_GetRules,
    getter: Servo_CssRules_GetDocumentRuleAt,
    debug: Servo_DocumentRule_Debug,
    to_css: Servo_DocumentRule_GetCssText,
    changed: Servo_StyleSet_DocumentRuleChanged,
}

impl_basic_rule_funcs! { (FontFeatureValues, FontFeatureValuesRule, FontFeatureValuesRule),
    getter: Servo_CssRules_GetFontFeatureValuesRuleAt,
    debug: Servo_FontFeatureValuesRule_Debug,
    to_css: Servo_FontFeatureValuesRule_GetCssText,
    changed: Servo_StyleSet_FontFeatureValuesRuleChanged,
}

impl_basic_rule_funcs! { (FontPaletteValues, FontPaletteValuesRule, FontPaletteValuesRule),
    getter: Servo_CssRules_GetFontPaletteValuesRuleAt,
    debug: Servo_FontPaletteValuesRule_Debug,
    to_css: Servo_FontPaletteValuesRule_GetCssText,
    changed: Servo_StyleSet_FontPaletteValuesRuleChanged,
}

impl_basic_rule_funcs! { (FontFace, FontFaceRule, Locked<FontFaceRule>),
    getter: Servo_CssRules_GetFontFaceRuleAt,
    debug: Servo_FontFaceRule_Debug,
    to_css: Servo_FontFaceRule_GetCssText,
    changed: Servo_StyleSet_FontFaceRuleChanged,
}

impl_basic_rule_funcs! { (CounterStyle, CounterStyleRule, Locked<CounterStyleRule>),
    getter: Servo_CssRules_GetCounterStyleRuleAt,
    debug: Servo_CounterStyleRule_Debug,
    to_css: Servo_CounterStyleRule_GetCssText,
    changed: Servo_StyleSet_CounterStyleRuleChanged,
}

impl_group_rule_funcs! { (Scope, ScopeRule, ScopeRule),
    get_rules: Servo_ScopeRule_GetRules,
    getter: Servo_CssRules_GetScopeRuleAt,
    debug: Servo_ScopeRule_Debug,
    to_css: Servo_ScopeRule_GetCssText,
    changed: Servo_StyleSet_ScopeRuleChanged,
}

impl_group_rule_funcs! { (StartingStyle, StartingStyleRule, StartingStyleRule),
    get_rules: Servo_StartingStyleRule_GetRules,
    getter: Servo_CssRules_GetStartingStyleRuleAt,
    debug: Servo_StartingStyleRule_Debug,
    to_css: Servo_StartingStyleRule_GetCssText,
    changed: Servo_StyleSet_StartingStyleRuleChanged,
}

#[no_mangle]
pub extern "C" fn Servo_StyleRule_GetStyle(
    rule: &LockedStyleRule,
) -> Strong<LockedDeclarationBlock> {
    read_locked_arc(rule, |rule: &StyleRule| rule.block.clone().into())
}

#[no_mangle]
pub extern "C" fn Servo_StyleRule_SetStyle(
    rule: &LockedStyleRule,
    declarations: &LockedDeclarationBlock,
) {
    write_locked_arc(rule, |rule: &mut StyleRule| {
        rule.block = unsafe { Arc::from_raw_addrefed(declarations) };
    })
}

#[no_mangle]
pub extern "C" fn Servo_StyleRule_GetSelectorText(rule: &LockedStyleRule, result: &mut nsACString) {
    read_locked_arc(rule, |rule| rule.selectors.to_css(result).unwrap());
}

fn desugared_selector_list(rules: &nsTArray<&LockedStyleRule>) -> SelectorList {
    let mut selectors: Option<SelectorList> = None;
    for rule in rules.iter().rev() {
        selectors = Some(read_locked_arc(rule, |rule| match selectors {
            Some(ref s) => rule.selectors.replace_parent_selector(s),
            None => rule.selectors.clone(),
        }));
    }
    selectors.expect("Empty rule chain?")
}

#[no_mangle]
pub extern "C" fn Servo_StyleRule_GetSelectorList(
    rules: &nsTArray<&LockedStyleRule>,
) -> *mut SelectorList {
    Box::into_raw(Box::new(desugared_selector_list(rules)))
}

#[no_mangle]
pub extern "C" fn Servo_StyleRule_GetSelectorDataAtIndex(
    rules: &nsTArray<&LockedStyleRule>,
    index: u32,
    text: Option<&mut nsACString>,
    specificity: Option<&mut u64>,
) {
    let selectors = desugared_selector_list(rules);
    let Some(selector) = selectors.slice().get(index as usize) else {
        return;
    };
    if let Some(text) = text {
        selector.to_css(text).unwrap();
    }
    if let Some(specificity) = specificity {
        *specificity = selector.specificity() as u64;
    }
}

#[no_mangle]
pub extern "C" fn Servo_StyleRule_GetSelectorCount(rule: &LockedStyleRule) -> u32 {
    read_locked_arc(rule, |rule| rule.selectors.len() as u32)
}

#[no_mangle]
pub extern "C" fn Servo_StyleRule_SelectorMatchesElement(
    rules: &nsTArray<&LockedStyleRule>,
    element: &RawGeckoElement,
    index: u32,
    host: Option<&RawGeckoElement>,
    pseudo_type: PseudoStyleType,
    relevant_link_visited: bool,
) -> bool {
    use selectors::matching::{
        matches_selector, IncludeStartingStyle, MatchingContext, MatchingMode, NeedsSelectorFlags,
        VisitedHandlingMode,
    };
    let selectors = desugared_selector_list(rules);
    let Some(selector) = selectors.slice().get(index as usize) else {
        return false;
    };
    let mut matching_mode = MatchingMode::Normal;
    match PseudoElement::from_pseudo_type(pseudo_type, None) {
        Some(pseudo) => {
            // We need to make sure that the requested pseudo element type
            // matches the selector pseudo element type before proceeding.
            match selector.pseudo_element() {
                Some(selector_pseudo) if *selector_pseudo == pseudo => {
                    matching_mode = MatchingMode::ForStatelessPseudoElement
                },
                _ => return false,
            };
        },
        None => {
            // Do not attempt to match if a pseudo element is requested and
            // this is not a pseudo element selector, or vice versa.
            if selector.has_pseudo_element() {
                return false;
            }
        },
    };

    let element = GeckoElement(element);
    let host = host.map(GeckoElement);
    let quirks_mode = element.as_node().owner_doc().quirks_mode();
    let mut selector_caches = SelectorCaches::default();
    let visited_mode = if relevant_link_visited {
        VisitedHandlingMode::RelevantLinkVisited
    } else {
        VisitedHandlingMode::AllLinksUnvisited
    };
    let mut ctx = MatchingContext::new_for_visited(
        matching_mode,
        /* bloom_filter = */ None,
        &mut selector_caches,
        visited_mode,
        IncludeStartingStyle::No,
        quirks_mode,
        NeedsSelectorFlags::No,
        MatchingForInvalidation::No,
    );
    ctx.with_shadow_host(host, |ctx| {
        matches_selector(selector, 0, None, &element, ctx)
    })
}

pub type SelectorList = selectors::SelectorList<style::gecko::selector_parser::SelectorImpl>;

#[no_mangle]
pub extern "C" fn Servo_StyleRule_SetSelectorText(
    contents: &StylesheetContents,
    rule: &LockedStyleRule,
    text: &nsACString,
) -> bool {
    let value_str = unsafe { text.as_str_unchecked() };

    write_locked_arc(rule, |rule: &mut StyleRule| {
        use selectors::parser::ParseRelative;
        use style::selector_parser::SelectorParser;

        let namespaces = contents.namespaces.read();
        let url_data = contents.url_data.read();
        let parser = SelectorParser {
            stylesheet_origin: contents.origin,
            namespaces: &namespaces,
            url_data: &url_data,
            for_supports_rule: false,
        };

        // TODO: Maybe allow setting relative selectors from the OM, if we're in a nested style
        // rule?
        let mut parser_input = ParserInput::new(&value_str);
        match SelectorList::parse(
            &parser,
            &mut Parser::new(&mut parser_input),
            ParseRelative::No,
        ) {
            Ok(selectors) => {
                rule.selectors = selectors;
                true
            },
            Err(_) => false,
        }
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_SelectorList_Closest(
    element: &RawGeckoElement,
    selectors: &SelectorList,
) -> *const RawGeckoElement {
    use style::dom_apis;

    let element = GeckoElement(element);
    let quirks_mode = element.as_node().owner_doc().quirks_mode();
    dom_apis::element_closest(element, &selectors, quirks_mode).map_or(ptr::null(), |e| e.0)
}

#[no_mangle]
pub unsafe extern "C" fn Servo_SelectorList_Matches(
    element: &RawGeckoElement,
    selectors: &SelectorList,
) -> bool {
    use style::dom_apis;

    let element = GeckoElement(element);
    let quirks_mode = element.as_node().owner_doc().quirks_mode();
    dom_apis::element_matches(&element, &selectors, quirks_mode)
}

#[no_mangle]
pub unsafe extern "C" fn Servo_SelectorList_QueryFirst(
    node: &RawGeckoNode,
    selectors: &SelectorList,
    may_use_invalidation: bool,
) -> *const RawGeckoElement {
    use style::dom_apis::{self, MayUseInvalidation, QueryFirst};

    let node = GeckoNode(node);
    let mut result = None;

    let may_use_invalidation = if may_use_invalidation {
        MayUseInvalidation::Yes
    } else {
        MayUseInvalidation::No
    };

    dom_apis::query_selector::<GeckoElement, QueryFirst>(
        node,
        &selectors,
        &mut result,
        may_use_invalidation,
    );

    result.map_or(ptr::null(), |e| e.0)
}

#[no_mangle]
pub unsafe extern "C" fn Servo_SelectorList_QueryAll(
    node: &RawGeckoNode,
    selectors: &SelectorList,
    content_list: *mut structs::nsSimpleContentList,
    may_use_invalidation: bool,
) {
    use style::dom_apis::{self, MayUseInvalidation, QueryAll};

    let node = GeckoNode(node);
    let mut result = SmallVec::new();

    let may_use_invalidation = if may_use_invalidation {
        MayUseInvalidation::Yes
    } else {
        MayUseInvalidation::No
    };

    dom_apis::query_selector::<GeckoElement, QueryAll>(
        node,
        &selectors,
        &mut result,
        may_use_invalidation,
    );

    if !result.is_empty() {
        // NOTE(emilio): This relies on a slice of GeckoElement having the same
        // memory representation than a slice of element pointers.
        bindings::Gecko_ContentList_AppendAll(
            content_list,
            result.as_ptr() as *mut *const _,
            result.len(),
        )
    }
}

#[no_mangle]
pub extern "C" fn Servo_ImportRule_GetHref(rule: &LockedImportRule, result: &mut nsAString) {
    read_locked_arc(rule, |rule: &ImportRule| {
        write!(result, "{}", rule.url.as_str()).unwrap();
    })
}

#[no_mangle]
pub extern "C" fn Servo_ImportRule_GetLayerName(rule: &LockedImportRule, result: &mut nsACString) {
    // https://w3c.github.io/csswg-drafts/cssom/#dom-cssimportrule-layername
    read_locked_arc(rule, |rule: &ImportRule| match rule.layer {
        ImportLayer::Named(ref name) => name.to_css(&mut CssWriter::new(result)).unwrap(), // "return the layer name declared in the at-rule itself"
        ImportLayer::Anonymous => {}, // "or an empty string if the layer is anonymous"
        ImportLayer::None => result.set_is_void(true), // "or null if the at-rule does not declare a layer"
    })
}

#[no_mangle]
pub extern "C" fn Servo_ImportRule_GetSupportsText(
    rule: &LockedImportRule,
    result: &mut nsACString,
) {
    read_locked_arc(rule, |rule: &ImportRule| match rule.supports {
        Some(ref supports) => supports
            .condition
            .to_css(&mut CssWriter::new(result))
            .unwrap(),
        None => result.set_is_void(true),
    })
}

#[no_mangle]
pub extern "C" fn Servo_ImportRule_GetSheet(rule: &LockedImportRule) -> *const DomStyleSheet {
    read_locked_arc(rule, |rule: &ImportRule| {
        rule.stylesheet
            .as_sheet()
            .map_or(ptr::null(), |s| s.raw() as *const DomStyleSheet)
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_ImportRule_SetSheet(
    rule: &LockedImportRule,
    sheet: *mut DomStyleSheet,
) {
    write_locked_arc(rule, |rule: &mut ImportRule| {
        rule.stylesheet = ImportSheet::new(GeckoStyleSheet::new(sheet));
    })
}

#[no_mangle]
pub extern "C" fn Servo_Keyframe_GetKeyText(keyframe: &LockedKeyframe, result: &mut nsACString) {
    read_locked_arc(keyframe, |keyframe: &Keyframe| {
        keyframe
            .selector
            .to_css(&mut CssWriter::new(result))
            .unwrap()
    })
}

#[no_mangle]
pub extern "C" fn Servo_Keyframe_SetKeyText(keyframe: &LockedKeyframe, text: &nsACString) -> bool {
    let text = unsafe { text.as_str_unchecked() };
    let mut input = ParserInput::new(&text);
    if let Ok(selector) = Parser::new(&mut input).parse_entirely(KeyframeSelector::parse) {
        write_locked_arc(keyframe, |keyframe: &mut Keyframe| {
            keyframe.selector = selector;
        });
        true
    } else {
        false
    }
}

#[no_mangle]
pub extern "C" fn Servo_Keyframe_GetStyle(
    keyframe: &LockedKeyframe,
) -> Strong<LockedDeclarationBlock> {
    read_locked_arc(keyframe, |keyframe: &Keyframe| {
        keyframe.block.clone().into()
    })
}

#[no_mangle]
pub extern "C" fn Servo_Keyframe_SetStyle(
    keyframe: &LockedKeyframe,
    declarations: &LockedDeclarationBlock,
) {
    write_locked_arc(keyframe, |keyframe: &mut Keyframe| {
        keyframe.block = unsafe { Arc::from_raw_addrefed(declarations) };
    })
}

#[no_mangle]
pub extern "C" fn Servo_KeyframesRule_GetName(rule: &LockedKeyframesRule) -> *mut nsAtom {
    read_locked_arc(rule, |rule: &KeyframesRule| rule.name.as_atom().as_ptr())
}

#[no_mangle]
pub unsafe extern "C" fn Servo_KeyframesRule_SetName(
    rule: &LockedKeyframesRule,
    name: *mut nsAtom,
) {
    write_locked_arc(rule, |rule: &mut KeyframesRule| {
        rule.name = KeyframesName::from_atom(Atom::from_addrefed(name));
    })
}

#[no_mangle]
pub extern "C" fn Servo_KeyframesRule_GetCount(rule: &LockedKeyframesRule) -> u32 {
    read_locked_arc(rule, |rule: &KeyframesRule| rule.keyframes.len() as u32)
}

#[no_mangle]
pub extern "C" fn Servo_KeyframesRule_GetKeyframeAt(
    rule: &LockedKeyframesRule,
    index: u32,
    line: &mut u32,
    column: &mut u32,
) -> Strong<LockedKeyframe> {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    let key = rule.read_with(&guard).keyframes[index as usize].clone();
    let location = key.read_with(&guard).source_location;
    *line = location.line as u32;
    *column = location.column as u32;
    key.into()
}

#[no_mangle]
pub extern "C" fn Servo_KeyframesRule_FindRule(
    rule: &LockedKeyframesRule,
    key: &nsACString,
) -> u32 {
    let key = unsafe { key.as_str_unchecked() };
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    rule.read_with(&guard)
        .find_rule(&guard, key)
        .map(|index| index as u32)
        .unwrap_or(u32::max_value())
}

#[no_mangle]
pub extern "C" fn Servo_KeyframesRule_AppendRule(
    rule: &LockedKeyframesRule,
    contents: &StylesheetContents,
    css: &nsACString,
) -> bool {
    let css = unsafe { css.as_str_unchecked() };
    let global_style_data = &*GLOBAL_STYLE_DATA;

    match Keyframe::parse(css, &contents, &global_style_data.shared_lock) {
        Ok(keyframe) => {
            write_locked_arc(rule, |rule: &mut KeyframesRule| {
                rule.keyframes.push(keyframe);
            });
            true
        },
        Err(..) => false,
    }
}

#[no_mangle]
pub extern "C" fn Servo_KeyframesRule_DeleteRule(rule: &LockedKeyframesRule, index: u32) {
    write_locked_arc(rule, |rule: &mut KeyframesRule| {
        rule.keyframes.remove(index as usize);
    })
}

#[no_mangle]
pub extern "C" fn Servo_MediaRule_GetMedia(rule: &MediaRule) -> Strong<LockedMediaList> {
    rule.media_queries.clone().into()
}

#[no_mangle]
pub extern "C" fn Servo_NamespaceRule_GetPrefix(rule: &NamespaceRule) -> *mut nsAtom {
    rule.prefix
        .as_ref()
        .map_or(atom!("").as_ptr(), |a| a.as_ptr())
}

#[no_mangle]
pub extern "C" fn Servo_NamespaceRule_GetURI(rule: &NamespaceRule) -> *mut nsAtom {
    rule.url.0.as_ptr()
}

#[no_mangle]
pub extern "C" fn Servo_MarginRule_GetStyle(rule: &MarginRule) -> Strong<LockedDeclarationBlock> {
    rule.block.clone().into()
}

#[no_mangle]
pub extern "C" fn Servo_MarginRule_GetName(rule: &MarginRule, out: &mut nsACString) {
    out.assign(rule.name());
}

#[no_mangle]
pub extern "C" fn Servo_PageRule_GetStyle(rule: &LockedPageRule) -> Strong<LockedDeclarationBlock> {
    read_locked_arc(rule, |rule: &PageRule| rule.block.clone().into())
}

#[no_mangle]
pub extern "C" fn Servo_PageRule_SetStyle(
    rule: &LockedPageRule,
    declarations: &LockedDeclarationBlock,
) {
    write_locked_arc(rule, |rule: &mut PageRule| {
        rule.block = unsafe { Arc::from_raw_addrefed(declarations) };
    })
}

#[no_mangle]
pub extern "C" fn Servo_PageRule_GetSelectorText(rule: &LockedPageRule, result: &mut nsACString) {
    read_locked_arc(rule, |rule: &PageRule| {
        rule.selectors.to_css(&mut CssWriter::new(result)).unwrap();
    })
}

#[no_mangle]
pub extern "C" fn Servo_PageRule_SetSelectorText(
    contents: &StylesheetContents,
    rule: &LockedPageRule,
    text: &nsACString,
) -> bool {
    let value_str = unsafe { text.as_str_unchecked() };

    write_locked_arc(rule, |rule: &mut PageRule| {
        use style::stylesheets::PageSelectors;

        let mut parser_input = ParserInput::new(&value_str);
        let mut parser = Parser::new(&mut parser_input);

        // Ensure that a blank input results in empty page selectors
        if parser.is_exhausted() {
            rule.selectors = PageSelectors::default();
            return true;
        }

        let url_data = contents.url_data.read();
        let context = ParserContext::new(
            Origin::Author,
            &url_data,
            None,
            ParsingMode::DEFAULT,
            QuirksMode::NoQuirks,
            /* namespaces = */ Default::default(),
            None,
            None,
        );

        match parser.parse_entirely(|i| PageSelectors::parse(&context, i)) {
            Ok(selectors) => {
                rule.selectors = selectors;
                true
            },
            Err(_) => false,
        }
    })
}

#[no_mangle]
pub extern "C" fn Servo_PropertyRule_GetName(rule: &PropertyRule, result: &mut nsACString) {
    write!(result, "--{}", rule.name.0).unwrap();
}

#[no_mangle]
pub extern "C" fn Servo_PropertyRule_GetSyntax(rule: &PropertyRule, result: &mut nsACString) {
    if let Some(syntax) = rule.data.syntax.specified_string() {
        result.assign(syntax);
    } else {
        debug_assert!(false, "Rule without specified syntax?");
    }
}

#[no_mangle]
pub extern "C" fn Servo_PropertyRule_GetInherits(rule: &PropertyRule) -> bool {
    rule.inherits()
}

#[no_mangle]
pub extern "C" fn Servo_PropertyRule_GetInitialValue(
    rule: &PropertyRule,
    result: &mut nsACString,
) -> bool {
    rule.data
        .initial_value
        .to_css(&mut CssWriter::new(result))
        .unwrap();
    rule.data.initial_value.is_some()
}

#[no_mangle]
pub extern "C" fn Servo_SupportsRule_GetConditionText(
    rule: &SupportsRule,
    result: &mut nsACString,
) {
    rule.condition.to_css(&mut CssWriter::new(result)).unwrap();
}

#[no_mangle]
pub extern "C" fn Servo_ContainerRule_GetConditionText(
    rule: &ContainerRule,
    result: &mut nsACString,
) {
    rule.condition.to_css(&mut CssWriter::new(result)).unwrap();
}

#[no_mangle]
pub extern "C" fn Servo_ContainerRule_GetContainerQuery(
    rule: &ContainerRule,
    result: &mut nsACString,
) {
    rule.query_condition()
        .to_css(&mut CssWriter::new(result))
        .unwrap();
}

#[no_mangle]
pub extern "C" fn Servo_ContainerRule_QueryContainerFor(
    rule: &ContainerRule,
    element: &RawGeckoElement,
) -> *const RawGeckoElement {
    rule.condition
        .find_container(GeckoElement(element), None)
        .map_or(ptr::null(), |result| result.element.0)
}

#[no_mangle]
pub extern "C" fn Servo_ContainerRule_GetContainerName(
    rule: &ContainerRule,
    result: &mut nsACString,
) {
    let name = rule.container_name();
    if !name.is_none() {
        name.to_css(&mut CssWriter::new(result)).unwrap();
    }
}

#[no_mangle]
pub extern "C" fn Servo_DocumentRule_GetConditionText(
    rule: &DocumentRule,
    result: &mut nsACString,
) {
    rule.condition.to_css(&mut CssWriter::new(result)).unwrap();
}

#[no_mangle]
pub extern "C" fn Servo_FontFeatureValuesRule_GetFontFamily(
    rule: &FontFeatureValuesRule,
    result: &mut nsACString,
) {
    rule.family_names
        .to_css(&mut CssWriter::new(result))
        .unwrap();
}

#[no_mangle]
pub extern "C" fn Servo_FontFeatureValuesRule_GetValueText(
    rule: &FontFeatureValuesRule,
    result: &mut nsACString,
) {
    rule.value_to_css(&mut CssWriter::new(result)).unwrap();
}

#[no_mangle]
pub extern "C" fn Servo_FontPaletteValuesRule_GetName(
    rule: &FontPaletteValuesRule,
    result: &mut nsACString,
) {
    rule.name.to_css(&mut CssWriter::new(result)).unwrap()
}

#[no_mangle]
pub extern "C" fn Servo_FontPaletteValuesRule_GetFontFamily(
    rule: &FontPaletteValuesRule,
    result: &mut nsACString,
) {
    if !rule.family_names.is_empty() {
        rule.family_names
            .to_css(&mut CssWriter::new(result))
            .unwrap()
    }
}

#[no_mangle]
pub extern "C" fn Servo_FontPaletteValuesRule_GetBasePalette(
    rule: &FontPaletteValuesRule,
    result: &mut nsACString,
) {
    rule.base_palette
        .to_css(&mut CssWriter::new(result))
        .unwrap()
}

#[no_mangle]
pub extern "C" fn Servo_FontPaletteValuesRule_GetOverrideColors(
    rule: &FontPaletteValuesRule,
    result: &mut nsACString,
) {
    if !rule.override_colors.is_empty() {
        rule.override_colors
            .to_css(&mut CssWriter::new(result))
            .unwrap()
    }
}

#[no_mangle]
pub extern "C" fn Servo_FontFaceRule_CreateEmpty() -> Strong<LockedFontFaceRule> {
    // XXX This is not great. We should split FontFace descriptor data
    // from the rule, so that we don't need to create the rule like this
    // and the descriptor data itself can be hold in UniquePtr from the
    // Gecko side. See bug 1450904.
    with_maybe_worker_shared_lock(|lock| {
        Arc::new(lock.wrap(FontFaceRule::empty(SourceLocation { line: 0, column: 0 }))).into()
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_FontFaceRule_Clone(
    rule: &LockedFontFaceRule,
) -> Strong<LockedFontFaceRule> {
    let clone = read_locked_arc_worker(rule, |rule: &FontFaceRule| rule.clone());
    with_maybe_worker_shared_lock(|lock| Arc::new(lock.wrap(clone)).into())
}

#[no_mangle]
pub unsafe extern "C" fn Servo_FontFaceRule_GetSourceLocation(
    rule: &LockedFontFaceRule,
    line: *mut u32,
    column: *mut u32,
) {
    read_locked_arc_worker(rule, |rule: &FontFaceRule| {
        let location = rule.source_location;
        *line.as_mut().unwrap() = location.line as u32;
        *column.as_mut().unwrap() = location.column as u32;
    });
}

macro_rules! apply_font_desc_list {
    ($apply_macro:ident) => {
        $apply_macro! {
            valid: [
                eCSSFontDesc_Family => family,
                eCSSFontDesc_Style => style,
                eCSSFontDesc_Weight => weight,
                eCSSFontDesc_Stretch => stretch,
                eCSSFontDesc_Src => sources,
                eCSSFontDesc_UnicodeRange => unicode_range,
                eCSSFontDesc_FontFeatureSettings => feature_settings,
                eCSSFontDesc_FontVariationSettings => variation_settings,
                eCSSFontDesc_FontLanguageOverride => language_override,
                eCSSFontDesc_Display => display,
                eCSSFontDesc_AscentOverride => ascent_override,
                eCSSFontDesc_DescentOverride => descent_override,
                eCSSFontDesc_LineGapOverride => line_gap_override,
                eCSSFontDesc_SizeAdjust => size_adjust,
            ]
            invalid: [
                eCSSFontDesc_UNKNOWN,
                eCSSFontDesc_COUNT,
            ]
        }
    };
}

#[no_mangle]
pub unsafe extern "C" fn Servo_FontFaceRule_Length(rule: &LockedFontFaceRule) -> u32 {
    read_locked_arc_worker(rule, |rule: &FontFaceRule| {
        let mut result = 0;
        macro_rules! count_values {
            (
                valid: [$($v_enum_name:ident => $field:ident,)*]
                invalid: [$($i_enum_name:ident,)*]
            ) => {
                $(if rule.$field.is_some() {
                    result += 1;
                })*
            }
        }
        apply_font_desc_list!(count_values);
        result
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_FontFaceRule_IndexGetter(
    rule: &LockedFontFaceRule,
    index: u32,
) -> nsCSSFontDesc {
    read_locked_arc_worker(rule, |rule: &FontFaceRule| {
        let mut count = 0;
        macro_rules! lookup_index {
            (
                valid: [$($v_enum_name:ident => $field:ident,)*]
                invalid: [$($i_enum_name:ident,)*]
            ) => {
                $(if rule.$field.is_some() {
                    count += 1;
                    if count - 1 == index {
                        return nsCSSFontDesc::$v_enum_name;
                    }
                })*
            }
        }
        apply_font_desc_list!(lookup_index);
        return nsCSSFontDesc::eCSSFontDesc_UNKNOWN;
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_FontFaceRule_GetDeclCssText(
    rule: &LockedFontFaceRule,
    result: &mut nsACString,
) {
    read_locked_arc_worker(rule, |rule: &FontFaceRule| {
        rule.decl_to_css(result).unwrap();
    })
}

macro_rules! simple_font_descriptor_getter_impl {
    ($rule:ident, $out:ident, $field:ident, $compute:ident) => {
        read_locked_arc_worker($rule, |rule: &FontFaceRule| {
            match rule.$field {
                None => return false,
                Some(ref f) => *$out = f.$compute(),
            }
            true
        })
    };
}

#[no_mangle]
pub extern "C" fn Servo_FontFaceRule_GetFontWeight(
    rule: &LockedFontFaceRule,
    out: &mut font_face::ComputedFontWeightRange,
) -> bool {
    simple_font_descriptor_getter_impl!(rule, out, weight, compute)
}

#[no_mangle]
pub extern "C" fn Servo_FontFaceRule_GetFontStretch(
    rule: &LockedFontFaceRule,
    out: &mut font_face::ComputedFontStretchRange,
) -> bool {
    simple_font_descriptor_getter_impl!(rule, out, stretch, compute)
}

#[no_mangle]
pub extern "C" fn Servo_FontFaceRule_GetFontStyle(
    rule: &LockedFontFaceRule,
    out: &mut font_face::ComputedFontStyleDescriptor,
) -> bool {
    simple_font_descriptor_getter_impl!(rule, out, style, compute)
}

#[no_mangle]
pub extern "C" fn Servo_FontFaceRule_GetFontDisplay(
    rule: &LockedFontFaceRule,
    out: &mut font_face::FontDisplay,
) -> bool {
    simple_font_descriptor_getter_impl!(rule, out, display, clone)
}

#[no_mangle]
pub extern "C" fn Servo_FontFaceRule_GetFontLanguageOverride(
    rule: &LockedFontFaceRule,
    out: &mut computed::FontLanguageOverride,
) -> bool {
    simple_font_descriptor_getter_impl!(rule, out, language_override, clone)
}

// Returns a Percentage of -1.0 if the override descriptor is present but 'normal'
// rather than an actual percentage value.
#[no_mangle]
pub extern "C" fn Servo_FontFaceRule_GetAscentOverride(
    rule: &LockedFontFaceRule,
    out: &mut computed::Percentage,
) -> bool {
    simple_font_descriptor_getter_impl!(rule, out, ascent_override, compute)
}

// Returns a Percentage of -1.0 if the override descriptor is present but 'normal'
// rather than an actual percentage value.
#[no_mangle]
pub extern "C" fn Servo_FontFaceRule_GetDescentOverride(
    rule: &LockedFontFaceRule,
    out: &mut computed::Percentage,
) -> bool {
    simple_font_descriptor_getter_impl!(rule, out, descent_override, compute)
}

// Returns a Percentage of -1.0 if the override descriptor is present but 'normal'
// rather than an actual percentage value.
#[no_mangle]
pub extern "C" fn Servo_FontFaceRule_GetLineGapOverride(
    rule: &LockedFontFaceRule,
    out: &mut computed::Percentage,
) -> bool {
    simple_font_descriptor_getter_impl!(rule, out, line_gap_override, compute)
}

#[no_mangle]
pub extern "C" fn Servo_FontFaceRule_GetSizeAdjust(
    rule: &LockedFontFaceRule,
    out: &mut computed::Percentage,
) -> bool {
    simple_font_descriptor_getter_impl!(rule, out, size_adjust, compute)
}

#[no_mangle]
pub unsafe extern "C" fn Servo_FontFaceRule_GetFamilyName(
    rule: &LockedFontFaceRule,
) -> *mut nsAtom {
    read_locked_arc_worker(rule, |rule: &FontFaceRule| {
        // TODO(emilio): font-family is a mandatory descriptor, can't we unwrap
        // here, and remove the null-checks in Gecko?
        rule.family
            .as_ref()
            .map_or(ptr::null_mut(), |f| f.name.as_ptr())
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_FontFaceRule_GetUnicodeRanges(
    rule: &LockedFontFaceRule,
    out_len: *mut usize,
) -> *const UnicodeRange {
    *out_len = 0;
    read_locked_arc_worker(rule, |rule: &FontFaceRule| {
        let ranges = match rule.unicode_range {
            Some(ref ranges) => ranges,
            None => return ptr::null(),
        };
        *out_len = ranges.len();
        ranges.as_ptr() as *const _
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_FontFaceRule_GetSources(
    rule: &LockedFontFaceRule,
    out: &mut nsTArray<FontFaceSourceListComponent>,
) {
    read_locked_arc_worker(rule, |rule: &FontFaceRule| {
        let sources = match rule.sources {
            Some(ref s) => s,
            None => return,
        };

        for source in sources.0.iter() {
            match *source {
                Source::Url(ref url) => {
                    out.push(FontFaceSourceListComponent::Url(&url.url));
                    if let Some(hint) = &url.format_hint {
                        match hint {
                            FontFaceSourceFormat::Keyword(kw) => {
                                out.push(FontFaceSourceListComponent::FormatHintKeyword(*kw))
                            },
                            FontFaceSourceFormat::String(s) => {
                                out.push(FontFaceSourceListComponent::FormatHintString {
                                    length: s.len(),
                                    utf8_bytes: s.as_ptr(),
                                })
                            },
                        }
                    }
                    if !url.tech_flags.is_empty() {
                        out.push(FontFaceSourceListComponent::TechFlags(url.tech_flags));
                    }
                },
                Source::Local(ref name) => {
                    out.push(FontFaceSourceListComponent::Local(name.name.as_ptr()));
                },
            }
        }
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_FontFaceRule_GetVariationSettings(
    rule: &LockedFontFaceRule,
    variations: &mut nsTArray<structs::gfxFontVariation>,
) {
    read_locked_arc_worker(rule, |rule: &FontFaceRule| {
        let source_variations = match rule.variation_settings {
            Some(ref v) => v,
            None => return,
        };

        variations.extend(
            source_variations
                .0
                .iter()
                .map(|source| structs::gfxFontVariation {
                    mTag: source.tag.0,
                    mValue: source.value.get(),
                }),
        );
    });
}

#[no_mangle]
pub unsafe extern "C" fn Servo_FontFaceRule_GetFeatureSettings(
    rule: &LockedFontFaceRule,
    features: &mut nsTArray<structs::gfxFontFeature>,
) {
    read_locked_arc_worker(rule, |rule: &FontFaceRule| {
        let source_features = match rule.feature_settings {
            Some(ref v) => v,
            None => return,
        };

        features.extend(
            source_features
                .0
                .iter()
                .map(|source| structs::gfxFontFeature {
                    mTag: source.tag.0,
                    mValue: source.value.value() as u32,
                }),
        );
    });
}

#[no_mangle]
pub extern "C" fn Servo_FontFaceRule_GetDescriptorCssText(
    rule: &LockedFontFaceRule,
    desc: nsCSSFontDesc,
    result: &mut nsACString,
) {
    read_locked_arc_worker(rule, |rule: &FontFaceRule| {
        let mut writer = CssWriter::new(result);
        macro_rules! to_css_text {
            (
                valid: [$($v_enum_name:ident => $field:ident,)*]
                invalid: [$($i_enum_name:ident,)*]
            ) => {
                match desc {
                    $(
                        nsCSSFontDesc::$v_enum_name => {
                            if let Some(ref value) = rule.$field {
                                value.to_css(&mut writer).unwrap();
                            }
                        }
                    )*
                    $(
                        nsCSSFontDesc::$i_enum_name => {
                            debug_assert!(false, "not a valid font descriptor");
                        }
                    )*
                }
            }
        }
        apply_font_desc_list!(to_css_text)
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_FontFaceRule_SetDescriptor(
    rule: &LockedFontFaceRule,
    desc: nsCSSFontDesc,
    value: &nsACString,
    data: *mut URLExtraData,
    out_changed: *mut bool,
) -> bool {
    let value = value.as_str_unchecked();
    let mut input = ParserInput::new(&value);
    let mut parser = Parser::new(&mut input);
    let url_data = UrlExtraData::from_ptr_ref(&data);
    let context = ParserContext::new(
        Origin::Author,
        url_data,
        Some(CssRuleType::FontFace),
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        /* namespaces = */ Default::default(),
        None,
        None,
    );

    write_locked_arc_worker(rule, |rule: &mut FontFaceRule| {
        macro_rules! to_css_text {
            (
                valid: [$($v_enum_name:ident => $field:ident,)*]
                invalid: [$($i_enum_name:ident,)*]
            ) => {
                match desc {
                    $(
                        nsCSSFontDesc::$v_enum_name => {
                            if let Ok(value) = parser.parse_entirely(|i| Parse::parse(&context, i)) {
                                let result = Some(value);
                                *out_changed = result != rule.$field;
                                rule.$field = result;
                                true
                            } else {
                                false
                            }
                        }
                    )*
                    $(
                        nsCSSFontDesc::$i_enum_name => {
                            debug_assert!(false, "not a valid font descriptor");
                            false
                        }
                    )*
                }
            }
        }
        apply_font_desc_list!(to_css_text)
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_FontFaceRule_ResetDescriptor(
    rule: &LockedFontFaceRule,
    desc: nsCSSFontDesc,
) {
    write_locked_arc_worker(rule, |rule: &mut FontFaceRule| {
        macro_rules! reset_desc {
            (
                valid: [$($v_enum_name:ident => $field:ident,)*]
                invalid: [$($i_enum_name:ident,)*]
            ) => {
                match desc {
                    $(nsCSSFontDesc::$v_enum_name => rule.$field = None,)*
                    $(nsCSSFontDesc::$i_enum_name => debug_assert!(false, "not a valid font descriptor"),)*
                }
            }
        }
        apply_font_desc_list!(reset_desc)
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_CounterStyleRule_GetName(
    rule: &LockedCounterStyleRule,
) -> *mut nsAtom {
    read_locked_arc(rule, |rule: &CounterStyleRule| rule.name().0.as_ptr())
}

#[no_mangle]
pub unsafe extern "C" fn Servo_CounterStyleRule_SetName(
    rule: &LockedCounterStyleRule,
    value: &nsACString,
) -> bool {
    let value = value.as_str_unchecked();
    let mut input = ParserInput::new(&value);
    let mut parser = Parser::new(&mut input);
    match parser.parse_entirely(counter_style::parse_counter_style_name_definition) {
        Ok(name) => {
            write_locked_arc(rule, |rule: &mut CounterStyleRule| rule.set_name(name));
            true
        },
        Err(_) => false,
    }
}

#[no_mangle]
pub unsafe extern "C" fn Servo_CounterStyleRule_GetGeneration(
    rule: &LockedCounterStyleRule,
) -> u32 {
    read_locked_arc(rule, |rule: &CounterStyleRule| rule.generation())
}

fn symbol_to_string(s: &counter_style::Symbol) -> nsString {
    match *s {
        counter_style::Symbol::String(ref s) => nsString::from(&**s),
        counter_style::Symbol::Ident(ref i) => nsString::from(i.0.as_slice()),
    }
}

// TODO(emilio): Cbindgen could be used to simplify a bunch of code here.
#[no_mangle]
pub unsafe extern "C" fn Servo_CounterStyleRule_GetPad(
    rule: &LockedCounterStyleRule,
    width: &mut i32,
    symbol: &mut nsString,
) -> bool {
    read_locked_arc(rule, |rule: &CounterStyleRule| {
        let pad = match rule.pad() {
            Some(pad) => pad,
            None => return false,
        };
        *width = pad.0.value();
        *symbol = symbol_to_string(&pad.1);
        true
    })
}

fn get_symbol(s: Option<&counter_style::Symbol>, out: &mut nsString) -> bool {
    let s = match s {
        Some(s) => s,
        None => return false,
    };
    *out = symbol_to_string(s);
    true
}

#[no_mangle]
pub unsafe extern "C" fn Servo_CounterStyleRule_GetPrefix(
    rule: &LockedCounterStyleRule,
    out: &mut nsString,
) -> bool {
    read_locked_arc(rule, |rule: &CounterStyleRule| {
        get_symbol(rule.prefix(), out)
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_CounterStyleRule_GetSuffix(
    rule: &LockedCounterStyleRule,
    out: &mut nsString,
) -> bool {
    read_locked_arc(rule, |rule: &CounterStyleRule| {
        get_symbol(rule.suffix(), out)
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_CounterStyleRule_GetNegative(
    rule: &LockedCounterStyleRule,
    prefix: &mut nsString,
    suffix: &mut nsString,
) -> bool {
    read_locked_arc(rule, |rule: &CounterStyleRule| {
        let negative = match rule.negative() {
            Some(n) => n,
            None => return false,
        };
        *prefix = symbol_to_string(&negative.0);
        *suffix = match negative.1 {
            Some(ref s) => symbol_to_string(s),
            None => nsString::new(),
        };
        true
    })
}

#[repr(u8)]
pub enum IsOrdinalInRange {
    Auto,
    InRange,
    NotInRange,
    NoOrdinalSpecified,
}

#[no_mangle]
pub unsafe extern "C" fn Servo_CounterStyleRule_IsInRange(
    rule: &LockedCounterStyleRule,
    ordinal: i32,
) -> IsOrdinalInRange {
    use style::counter_style::CounterBound;
    read_locked_arc(rule, |rule: &CounterStyleRule| {
        let range = match rule.range() {
            Some(r) => r,
            None => return IsOrdinalInRange::NoOrdinalSpecified,
        };

        if range.0.is_empty() {
            return IsOrdinalInRange::Auto;
        }

        let in_range = range.0.iter().any(|r| {
            if let CounterBound::Integer(start) = r.start {
                if start.value() > ordinal {
                    return false;
                }
            }

            if let CounterBound::Integer(end) = r.end {
                if end.value() < ordinal {
                    return false;
                }
            }

            true
        });

        if in_range {
            IsOrdinalInRange::InRange
        } else {
            IsOrdinalInRange::NotInRange
        }
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_CounterStyleRule_GetSymbols(
    rule: &LockedCounterStyleRule,
    count: &mut usize,
) -> *const counter_style::Symbol {
    read_locked_arc(rule, |rule: &CounterStyleRule| {
        let symbols = match rule.symbols() {
            Some(s) => &*s.0,
            None => &[],
        };
        *count = symbols.len();
        symbols.as_ptr()
    })
}

#[repr(C)]
pub struct AdditiveSymbol {
    pub weight: i32,
    pub symbol: nsString,
}

#[no_mangle]
pub unsafe extern "C" fn Servo_CounterStyleRule_GetAdditiveSymbols(
    rule: &LockedCounterStyleRule,
    symbols: &mut style::OwnedSlice<AdditiveSymbol>,
) {
    read_locked_arc(rule, |rule: &CounterStyleRule| {
        *symbols = match rule.additive_symbols() {
            Some(s) => {
                s.0.iter()
                    .map(|s| AdditiveSymbol {
                        weight: s.weight.value(),
                        symbol: symbol_to_string(&s.symbol),
                    })
                    .collect()
            },
            None => style::OwnedSlice::default(),
        };
    })
}

#[repr(C, u8)]
pub enum CounterSpeakAs {
    None,
    Auto,
    Bullets,
    Numbers,
    Words,
    Ident(*mut nsAtom),
}

#[no_mangle]
pub unsafe extern "C" fn Servo_CounterStyleRule_GetSpeakAs(
    rule: &LockedCounterStyleRule,
    out: &mut CounterSpeakAs,
) {
    use style::counter_style::SpeakAs;
    *out = read_locked_arc(rule, |rule: &CounterStyleRule| {
        let speak_as = match rule.speak_as() {
            Some(s) => s,
            None => return CounterSpeakAs::None,
        };
        match *speak_as {
            SpeakAs::Auto => CounterSpeakAs::Auto,
            SpeakAs::Bullets => CounterSpeakAs::Bullets,
            SpeakAs::Numbers => CounterSpeakAs::Numbers,
            SpeakAs::Words => CounterSpeakAs::Words,
            SpeakAs::Other(ref other) => CounterSpeakAs::Ident(other.0.as_ptr()),
        }
    });
}

#[repr(u8)]
pub enum CounterSystem {
    Cyclic = 0,
    Numeric,
    Alphabetic,
    Symbolic,
    Additive,
    Fixed,
    Extends,
}

#[no_mangle]
pub unsafe extern "C" fn Servo_CounterStyleRule_GetSystem(
    rule: &LockedCounterStyleRule,
) -> CounterSystem {
    use style::counter_style::System;
    read_locked_arc(rule, |rule: &CounterStyleRule| {
        match *rule.resolved_system() {
            System::Cyclic => CounterSystem::Cyclic,
            System::Numeric => CounterSystem::Numeric,
            System::Alphabetic => CounterSystem::Alphabetic,
            System::Symbolic => CounterSystem::Symbolic,
            System::Additive => CounterSystem::Additive,
            System::Fixed { .. } => CounterSystem::Fixed,
            System::Extends(_) => CounterSystem::Extends,
        }
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_CounterStyleRule_GetExtended(
    rule: &LockedCounterStyleRule,
) -> *mut nsAtom {
    read_locked_arc(rule, |rule: &CounterStyleRule| {
        match *rule.resolved_system() {
            counter_style::System::Extends(ref name) => name.0.as_ptr(),
            _ => {
                debug_assert!(false, "Not extends system");
                ptr::null_mut()
            },
        }
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_CounterStyleRule_GetFixedFirstValue(
    rule: &LockedCounterStyleRule,
) -> i32 {
    read_locked_arc(rule, |rule: &CounterStyleRule| {
        match *rule.resolved_system() {
            counter_style::System::Fixed { first_symbol_value } => {
                first_symbol_value.map_or(1, |v| v.value())
            },
            _ => {
                debug_assert!(false, "Not fixed system");
                0
            },
        }
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_CounterStyleRule_GetFallback(
    rule: &LockedCounterStyleRule,
) -> *mut nsAtom {
    read_locked_arc(rule, |rule: &CounterStyleRule| {
        rule.fallback().map_or(ptr::null_mut(), |i| i.0 .0.as_ptr())
    })
}

macro_rules! counter_style_descriptors {
    {
        valid: [
            $($desc:ident => $getter:ident / $setter:ident,)+
        ]
        invalid: [
            $($i_desc:ident,)+
        ]
    } => {
        #[no_mangle]
        pub unsafe extern "C" fn Servo_CounterStyleRule_GetDescriptorCssText(
            rule: &LockedCounterStyleRule,
            desc: nsCSSCounterDesc,
            result: &mut nsACString,
        ) {
            let mut writer = CssWriter::new(result);
            read_locked_arc(rule, |rule: &CounterStyleRule| {
                match desc {
                    $(nsCSSCounterDesc::$desc => {
                        if let Some(value) = rule.$getter() {
                            value.to_css(&mut writer).unwrap();
                        }
                    })+
                    $(nsCSSCounterDesc::$i_desc => unreachable!(),)+
                }
            });
        }

        #[no_mangle]
        pub unsafe extern "C" fn Servo_CounterStyleRule_SetDescriptor(
            rule: &LockedCounterStyleRule,
            desc: nsCSSCounterDesc,
            value: &nsACString,
        ) -> bool {
            let value = value.as_str_unchecked();
            let mut input = ParserInput::new(&value);
            let mut parser = Parser::new(&mut input);
            let url_data = dummy_url_data();
            let context = ParserContext::new(
                Origin::Author,
                url_data,
                Some(CssRuleType::CounterStyle),
                ParsingMode::DEFAULT,
                QuirksMode::NoQuirks,
                /* namespaces = */ Default::default(),
                None,
                None,
            );

            write_locked_arc(rule, |rule: &mut CounterStyleRule| {
                match desc {
                    $(nsCSSCounterDesc::$desc => {
                        match parser.parse_entirely(|i| Parse::parse(&context, i)) {
                            Ok(value) => rule.$setter(value),
                            Err(_) => false,
                        }
                    })+
                    $(nsCSSCounterDesc::$i_desc => unreachable!(),)+
                }
            })
        }
    }
}

counter_style_descriptors! {
    valid: [
        eCSSCounterDesc_System => system / set_system,
        eCSSCounterDesc_Symbols => symbols / set_symbols,
        eCSSCounterDesc_AdditiveSymbols => additive_symbols / set_additive_symbols,
        eCSSCounterDesc_Negative => negative / set_negative,
        eCSSCounterDesc_Prefix => prefix / set_prefix,
        eCSSCounterDesc_Suffix => suffix / set_suffix,
        eCSSCounterDesc_Range => range / set_range,
        eCSSCounterDesc_Pad => pad / set_pad,
        eCSSCounterDesc_Fallback => fallback / set_fallback,
        eCSSCounterDesc_SpeakAs => speak_as / set_speak_as,
    ]
    invalid: [
        eCSSCounterDesc_UNKNOWN,
        eCSSCounterDesc_COUNT,
    ]
}

#[no_mangle]
pub unsafe extern "C" fn Servo_ComputedValues_GetForPageContent(
    raw_data: &PerDocumentStyleData,
    page_name: *const nsAtom,
    pseudos: PagePseudoClassFlags,
) -> Strong<ComputedValues> {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    let guards = StylesheetGuards::same(&guard);
    let data = raw_data.borrow_mut();
    let cascade_data = data.stylist.cascade_data();

    let mut extra_declarations = vec![];
    let iter = data.stylist.iter_extra_data_origins_rev();
    let name = if !page_name.is_null() {
        Some(Atom::from_raw(page_name as *mut nsAtom))
    } else {
        None
    };
    for (data, origin) in iter {
        data.pages.match_and_append_rules(
            &mut extra_declarations,
            origin,
            &guards,
            cascade_data,
            &name,
            pseudos,
        );
    }

    let rule_node = data.stylist.rule_node_for_precomputed_pseudo(
        &guards,
        &PseudoElement::PageContent,
        extra_declarations,
    );

    data.stylist
        .precomputed_values_for_pseudo_with_rule_node::<GeckoElement>(
            &guards,
            &PseudoElement::PageContent,
            None,
            rule_node,
        )
        .into()
}

#[no_mangle]
pub unsafe extern "C" fn Servo_ComputedValues_GetForAnonymousBox(
    parent_style_or_null: Option<&ComputedValues>,
    pseudo: PseudoStyleType,
    raw_data: &PerDocumentStyleData,
) -> Strong<ComputedValues> {
    let pseudo = PseudoElement::from_pseudo_type(pseudo, None).unwrap();
    debug_assert!(pseudo.is_anon_box());
    debug_assert_ne!(pseudo, PseudoElement::PageContent);
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    let guards = StylesheetGuards::same(&guard);
    let data = raw_data.borrow_mut();
    let rule_node = data
        .stylist
        .rule_node_for_precomputed_pseudo(&guards, &pseudo, vec![]);

    data.stylist
        .precomputed_values_for_pseudo_with_rule_node::<GeckoElement>(
            &guards,
            &pseudo,
            parent_style_or_null.map(|x| &*x),
            rule_node,
        )
        .into()
}

fn get_functional_pseudo_parameter_atom(
    functional_pseudo_parameter: *mut nsAtom,
) -> Option<AtomIdent> {
    if functional_pseudo_parameter.is_null() {
        None
    } else {
        Some(AtomIdent::new(unsafe {
            Atom::from_raw(functional_pseudo_parameter)
        }))
    }
}

#[no_mangle]
pub extern "C" fn Servo_ResolvePseudoStyle(
    element: &RawGeckoElement,
    pseudo_type: PseudoStyleType,
    functional_pseudo_parameter: *mut nsAtom,
    is_probe: bool,
    inherited_style: Option<&ComputedValues>,
    raw_data: &PerDocumentStyleData,
) -> Strong<ComputedValues> {
    let element = GeckoElement(element);
    let doc_data = raw_data.borrow();

    debug!(
        "Servo_ResolvePseudoStyle: {:?} {:?}, is_probe: {}",
        element,
        PseudoElement::from_pseudo_type(
            pseudo_type,
            get_functional_pseudo_parameter_atom(functional_pseudo_parameter)
        ),
        is_probe
    );

    let data = element.borrow_data();

    let data = match data.as_ref() {
        Some(data) if data.has_styles() => data,
        _ => {
            // FIXME(bholley, emilio): Assert against this.
            //
            // Known offender is nsMathMLmoFrame::MarkIntrinsicISizesDirty,
            // which goes and does a bunch of work involving style resolution.
            //
            // Bug 1403865 tracks fixing it, and potentially adding an assert
            // here instead.
            warn!("Calling Servo_ResolvePseudoStyle on unstyled element");
            return if is_probe {
                Strong::null()
            } else {
                doc_data.default_computed_values().clone().into()
            };
        },
    };

    let pseudo_element = PseudoElement::from_pseudo_type(
        pseudo_type,
        get_functional_pseudo_parameter_atom(functional_pseudo_parameter),
    )
    .expect("ResolvePseudoStyle with a non-pseudo?");

    let matching_fn = |pseudo: &PseudoElement| *pseudo == pseudo_element;

    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    let style = get_pseudo_style(
        &guard,
        element,
        &pseudo_element,
        RuleInclusion::All,
        &data.styles,
        inherited_style,
        &doc_data.stylist,
        is_probe,
        /* matching_func = */
        if pseudo_element.is_highlight() {
            Some(&matching_fn)
        } else {
            None
        },
    );

    match style {
        Some(s) => s.into(),
        None => {
            debug_assert!(is_probe);
            Strong::null()
        },
    }
}

fn debug_atom_array(atoms: &nsTArray<structs::RefPtr<nsAtom>>) -> String {
    let mut result = String::from("[");
    for atom in atoms.iter() {
        if atom.mRawPtr.is_null() {
            result += "(null), ";
        } else {
            let atom = unsafe { WeakAtom::new(atom.mRawPtr) };
            write!(result, "{}, ", atom).unwrap();
        }
    }
    result.push(']');
    result
}

#[no_mangle]
pub extern "C" fn Servo_ComputedValues_ResolveXULTreePseudoStyle(
    element: &RawGeckoElement,
    pseudo_tag: *mut nsAtom,
    inherited_style: &ComputedValues,
    input_word: &nsTArray<structs::RefPtr<nsAtom>>,
    raw_data: &PerDocumentStyleData,
) -> Strong<ComputedValues> {
    let element = GeckoElement(element);
    let data = element
        .borrow_data()
        .expect("Calling ResolveXULTreePseudoStyle on unstyled element?");

    let pseudo = unsafe {
        Atom::with(pseudo_tag, |atom| {
            PseudoElement::from_tree_pseudo_atom(atom, Box::new([]))
        })
        .expect("ResolveXULTreePseudoStyle with a non-tree pseudo?")
    };
    let doc_data = raw_data.borrow();

    debug!(
        "ResolveXULTreePseudoStyle: {:?} {:?} {}",
        element,
        pseudo,
        debug_atom_array(input_word)
    );

    let matching_fn = |pseudo: &PseudoElement| {
        let args = pseudo
            .tree_pseudo_args()
            .expect("Not a tree pseudo-element?");
        args.iter()
            .all(|atom| input_word.iter().any(|item| atom.as_ptr() == item.mRawPtr))
    };

    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    get_pseudo_style(
        &guard,
        element,
        &pseudo,
        RuleInclusion::All,
        &data.styles,
        Some(inherited_style),
        &doc_data.stylist,
        /* is_probe = */ false,
        Some(&matching_fn),
    )
    .unwrap()
    .into()
}

#[no_mangle]
pub extern "C" fn Servo_SetExplicitStyle(element: &RawGeckoElement, style: &ComputedValues) {
    let element = GeckoElement(element);
    debug!("Servo_SetExplicitStyle: {:?}", element);
    // We only support this API for initial styling. There's no reason it couldn't
    // work for other things, we just haven't had a reason to do so.
    debug_assert!(!element.has_data());
    let mut data = unsafe { element.ensure_data() };
    data.styles.primary = Some(unsafe { Arc::from_raw_addrefed(style) });
}

fn get_pseudo_style(
    guard: &SharedRwLockReadGuard,
    element: GeckoElement,
    pseudo: &PseudoElement,
    rule_inclusion: RuleInclusion,
    styles: &ElementStyles,
    inherited_styles: Option<&ComputedValues>,
    stylist: &Stylist,
    is_probe: bool,
    matching_func: Option<&dyn Fn(&PseudoElement) -> bool>,
) -> Option<Arc<ComputedValues>> {
    let style = match pseudo.cascade_type() {
        PseudoElementCascadeType::Eager => {
            match *pseudo {
                PseudoElement::FirstLetter => {
                    styles.pseudos.get(&pseudo).map(|pseudo_styles| {
                        // inherited_styles can be None when doing lazy resolution
                        // (e.g. for computed style) or when probing.  In that case
                        // we just inherit from our element, which is what Gecko
                        // does in that situation.  What should actually happen in
                        // the computed style case is a bit unclear.
                        let inherited_styles = inherited_styles.unwrap_or(styles.primary());
                        let guards = StylesheetGuards::same(guard);
                        let inputs = CascadeInputs::new_from_style(pseudo_styles);
                        stylist.compute_pseudo_element_style_with_inputs(
                            inputs,
                            pseudo,
                            &guards,
                            Some(inherited_styles),
                            Some(element),
                        )
                    })
                },
                _ => {
                    // Unfortunately, we can't assert that inherited_styles, if
                    // present, is pointer-equal to styles.primary(), or even
                    // equal in any meaningful way.  The way it can fail is as
                    // follows.  Say we append an element with a ::before,
                    // ::after, or ::first-line to a parent with a ::first-line,
                    // such that the element ends up on the first line of the
                    // parent (e.g. it's an inline-block in the case it has a
                    // ::first-line, or any container in the ::before/::after
                    // cases).  Then gecko will update its frame's style to
                    // inherit from the parent's ::first-line.  The next time we
                    // try to get the ::before/::after/::first-line style for
                    // the kid, we'll likely pass in the frame's style as
                    // inherited_styles, but that's not pointer-identical to
                    // styles.primary(), because it got reparented.
                    //
                    // Now in practice this turns out to be OK, because all the
                    // cases in which there's a mismatch go ahead and reparent
                    // styles again as needed to make sure the ::first-line
                    // affects all the things it should affect.  But it makes it
                    // impossible to assert anything about the two styles
                    // matching here, unfortunately.
                    styles.pseudos.get(&pseudo).cloned()
                },
            }
        },
        PseudoElementCascadeType::Precomputed => unreachable!("No anonymous boxes"),
        PseudoElementCascadeType::Lazy => {
            debug_assert!(
                inherited_styles.is_none() ||
                    ptr::eq(inherited_styles.unwrap(), &**styles.primary())
            );
            let originating_element_style = styles.primary();
            let guards = StylesheetGuards::same(guard);
            stylist.lazily_compute_pseudo_element_style(
                &guards,
                element,
                &pseudo,
                rule_inclusion,
                originating_element_style,
                is_probe,
                matching_func,
            )
        },
    };

    if is_probe {
        return style;
    }

    Some(style.unwrap_or_else(|| {
        StyleBuilder::for_inheritance(
            stylist.device(),
            Some(stylist),
            Some(styles.primary()),
            Some(pseudo),
        )
        .build()
    }))
}

#[no_mangle]
pub unsafe extern "C" fn Servo_ComputedValues_Inherit(
    raw_data: &PerDocumentStyleData,
    pseudo: PseudoStyleType,
    parent_style_context: Option<&ComputedValues>,
    target: structs::InheritTarget,
) -> Strong<ComputedValues> {
    let data = raw_data.borrow();

    let for_text = target == structs::InheritTarget::Text;
    let pseudo = PseudoElement::from_pseudo_type(pseudo, None).unwrap();
    debug_assert!(pseudo.is_anon_box());

    let mut style = StyleBuilder::for_inheritance(
        data.stylist.device(),
        Some(&data.stylist),
        parent_style_context,
        Some(&pseudo),
    );

    if for_text {
        StyleAdjuster::new(&mut style).adjust_for_text();
    }

    style.build().into()
}

#[no_mangle]
pub extern "C" fn Servo_ComputedValues_SpecifiesAnimationsOrTransitions(
    values: &ComputedValues,
) -> bool {
    let ui = values.get_ui();
    ui.specifies_animations() || ui.specifies_transitions()
}

#[no_mangle]
pub extern "C" fn Servo_ComputedValues_GetStyleRuleList(
    values: &ComputedValues,
    rules: &mut nsTArray<*const LockedStyleRule>,
) {
    let rule_node = match values.rules {
        Some(ref r) => r,
        None => return,
    };

    for node in rule_node.self_and_ancestors() {
        let style_rule = match node.style_source().and_then(|x| x.as_rule()) {
            Some(rule) => rule,
            _ => continue,
        };

        // For the rules with any important declaration, we insert them into
        // rule tree twice, one for normal level and another for important
        // level. So, we skip the important one to keep the specificity order of
        // rules.
        if node.importance().important() {
            continue;
        }

        rules.push(&*style_rule);
    }
}

/// println_stderr!() calls Gecko's printf_stderr(), which, unlike eprintln!(),
/// will funnel output to Android logcat.
#[cfg(feature = "gecko_debug")]
macro_rules! println_stderr {
    ($($e:expr),+) => {
        {
            let mut s = nsCString::new();
            write!(s, $($e),+).unwrap();
            s.write_char('\n').unwrap();
            unsafe { bindings::Gecko_PrintfStderr(&s); }
        }
    }
}

#[cfg(feature = "gecko_debug")]
fn dump_properties_and_rules(cv: &ComputedValues, properties: &LonghandIdSet) {
    println_stderr!("  Properties:");
    for p in properties.iter() {
        let mut v = nsCString::new();
        cv.computed_or_resolved_value(p, None, &mut v).unwrap();
        println_stderr!("    {:?}: {}", p, v);
    }
    dump_rules(cv);
}

#[cfg(feature = "gecko_debug")]
fn dump_rules(cv: &ComputedValues) {
    println_stderr!("  Rules({:?}):", cv.pseudo());
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    if let Some(rules) = cv.rules.as_ref() {
        for rn in rules.self_and_ancestors() {
            if rn.importance().important() {
                continue;
            }
            if let Some(d) = rn.style_source().and_then(|s| s.as_declarations()) {
                println_stderr!("    [DeclarationBlock: {:?}]", d);
            }
            if let Some(r) = rn.style_source().and_then(|s| s.as_rule()) {
                let mut s = nsCString::new();
                r.read_with(&guard).to_css(&guard, &mut s).unwrap();
                println_stderr!("    {}", s);
            }
        }
    }
}

#[cfg(feature = "gecko_debug")]
#[no_mangle]
pub extern "C" fn Servo_ComputedValues_EqualForCachedAnonymousContentStyle(
    a: &ComputedValues,
    b: &ComputedValues,
) -> bool {
    let mut differing_properties = a.differing_properties(b);

    // Ignore any difference in -x-lang, which we can't override in the rules in scrollbars.css,
    // but which makes no difference for the anonymous content subtrees we cache style for.
    differing_properties.remove(LonghandId::XLang);
    // Similarly, -x-lang can influence the font-family fallback we have for the initial
    // font-family so remove it as well.
    differing_properties.remove(LonghandId::FontFamily);
    // We reset font-size to an explicit pixel value, and thus it can get affected by our inherited
    // effective zoom. But we don't care about it for the same reason as above.
    differing_properties.remove(LonghandId::FontSize);

    // Ignore any difference in pref-controlled, inherited properties.  These properties may or may
    // not be set by the 'all' declaration in scrollbars.css, depending on whether the pref was
    // enabled at the time the UA sheets were parsed.
    //
    // If you add a new pref-controlled, inherited property, it must be defined with
    // `has_effect_on_gecko_scrollbars=False` to declare that different values of this property on
    // a <scrollbar> element or its descendant scrollbar part elements should have no effect on
    // their rendering and behavior.
    //
    // If you do need a pref-controlled, inherited property to have an effect on these elements,
    // then you will need to add some checks to the
    // nsIAnonymousContentCreator::CreateAnonymousContent implementations of ScrollContainerFrame
    // and nsScrollbarFrame to clear the AnonymousContentKey if a non-initial value is used.
    differing_properties.remove_all(&LonghandIdSet::has_no_effect_on_gecko_scrollbars());

    if !differing_properties.is_empty() {
        println_stderr!("Actual style:");
        dump_properties_and_rules(a, &differing_properties);
        println_stderr!("Expected style:");
        dump_properties_and_rules(b, &differing_properties);
    }

    differing_properties.is_empty()
}

#[cfg(feature = "gecko_debug")]
#[no_mangle]
pub extern "C" fn Servo_ComputedValues_DumpMatchedRules(s: &ComputedValues) {
    dump_rules(s);
}

#[no_mangle]
pub extern "C" fn Servo_ComputedValues_BlockifiedDisplay(
    style: &ComputedValues,
    is_root_element: bool,
) -> u16 {
    let display = style.get_box().clone_display();
    let blockified_display = display.equivalent_block_display(is_root_element);
    blockified_display.to_u16()
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_Init(doc: &structs::Document) -> *mut PerDocumentStyleData {
    let data = Box::new(PerDocumentStyleData::new(doc));

    // Do this here rather than in Servo_Initialize since we need a document to
    // get the default computed values from.
    style::properties::generated::gecko::assert_initial_values_match(&data);

    Box::into_raw(data) as *mut PerDocumentStyleData
}

#[no_mangle]
pub unsafe extern "C" fn Servo_StyleSet_Drop(data: *mut PerDocumentStyleData) {
    let _ = Box::from_raw(data);
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_RebuildCachedData(raw_data: &PerDocumentStyleData) {
    let mut data = raw_data.borrow_mut();
    data.stylist.device_mut().rebuild_cached_data();
    data.undisplayed_style_cache.clear();
}

#[no_mangle]
pub unsafe extern "C" fn Servo_StyleSet_CompatModeChanged(raw_data: &PerDocumentStyleData) {
    let mut data = raw_data.borrow_mut();
    let quirks_mode = data.stylist.device().document().mCompatMode;
    data.stylist.set_quirks_mode(quirks_mode.into());
}

fn parse_property_into(
    declarations: &mut SourcePropertyDeclaration,
    property_id: PropertyId,
    value: &nsACString,
    origin: Origin,
    url_data: &UrlExtraData,
    parsing_mode: ParsingMode,
    quirks_mode: QuirksMode,
    rule_type: CssRuleType,
    reporter: Option<&dyn ParseErrorReporter>,
) -> Result<(), ()> {
    let value = unsafe { value.as_str_unchecked() };

    if let Some(non_custom) = property_id.non_custom_id() {
        if !non_custom.allowed_in_rule(rule_type.into()) {
            return Err(());
        }
    }

    parse_one_declaration_into(
        declarations,
        property_id,
        value,
        origin,
        url_data,
        reporter,
        parsing_mode,
        quirks_mode,
        rule_type,
    )
}

#[no_mangle]
pub unsafe extern "C" fn Servo_ParseProperty(
    property: &structs::AnimatedPropertyID,
    value: &nsACString,
    data: *mut URLExtraData,
    parsing_mode: ParsingMode,
    quirks_mode: nsCompatibility,
    loader: *mut Loader,
    rule_type: CssRuleType,
) -> Strong<LockedDeclarationBlock> {
    let id = get_property_id_from_animatedpropertyid!(property, Strong::null());
    let mut declarations = SourcePropertyDeclaration::default();
    let reporter = ErrorReporter::new(ptr::null_mut(), loader, data);
    let data = UrlExtraData::from_ptr_ref(&data);
    let result = parse_property_into(
        &mut declarations,
        id,
        value,
        Origin::Author,
        data,
        parsing_mode,
        quirks_mode.into(),
        rule_type,
        reporter.as_ref().map(|r| r as &dyn ParseErrorReporter),
    );

    match result {
        Ok(()) => {
            let global_style_data = &*GLOBAL_STYLE_DATA;
            let mut block = PropertyDeclarationBlock::new();
            block.extend(declarations.drain(), Importance::Normal);
            Arc::new(global_style_data.shared_lock.wrap(block)).into()
        },
        Err(_) => Strong::null(),
    }
}

#[no_mangle]
pub extern "C" fn Servo_ParseEasing(
    easing: &nsACString,
    output: &mut ComputedTimingFunction,
) -> bool {
    use style::properties::longhands::transition_timing_function;

    let context = ParserContext::new(
        Origin::Author,
        unsafe { dummy_url_data() },
        Some(CssRuleType::Style),
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        /* namespaces = */ Default::default(),
        None,
        None,
    );
    let easing = easing.to_string();
    let mut input = ParserInput::new(&easing);
    let mut parser = Parser::new(&mut input);
    let result =
        parser.parse_entirely(|p| transition_timing_function::single_value::parse(&context, p));
    match result {
        Ok(parsed_easing) => {
            *output = parsed_easing.to_computed_value_without_context();
            true
        },
        Err(_) => false,
    }
}

#[no_mangle]
pub extern "C" fn Servo_SerializeEasing(easing: &ComputedTimingFunction, output: &mut nsACString) {
    easing.to_css(&mut CssWriter::new(output)).unwrap();
}

#[no_mangle]
pub extern "C" fn Servo_GetProperties_Overriding_Animation(
    element: &RawGeckoElement,
    list: &nsTArray<nsCSSPropertyID>,
    set: &mut structs::nsCSSPropertyIDSet,
) {
    let element = GeckoElement(element);
    let element_data = match element.borrow_data() {
        Some(data) => data,
        None => return,
    };
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    let guards = StylesheetGuards::same(&guard);
    let (overridden, custom) = element_data
        .styles
        .primary()
        .rules()
        .get_properties_overriding_animations(&guards);
    for p in list.iter() {
        match NonCustomPropertyId::from_nscsspropertyid(*p) {
            Some(property) => {
                if let Some(id) = property.as_longhand() {
                    if overridden.contains(id) {
                        unsafe { Gecko_AddPropertyToSet(set, *p) };
                    }
                }
            },
            None => {
                if *p == nsCSSPropertyID::eCSSPropertyExtra_variable && custom {
                    unsafe { Gecko_AddPropertyToSet(set, *p) };
                }
            },
        }
    }
}

#[no_mangle]
pub extern "C" fn Servo_MatrixTransform_Operate(
    matrix_operator: MatrixTransformOperator,
    from: *const structs::Matrix4x4Components,
    to: *const structs::Matrix4x4Components,
    progress: f64,
    output: *mut structs::Matrix4x4Components,
) {
    use self::MatrixTransformOperator::{Accumulate, Interpolate};
    use style::values::computed::transform::Matrix3D;

    let from = Matrix3D::from(unsafe { from.as_ref() }.expect("not a valid 'from' matrix"));
    let to = Matrix3D::from(unsafe { to.as_ref() }.expect("not a valid 'to' matrix"));
    let result = match matrix_operator {
        Interpolate => from.animate(&to, Procedure::Interpolate { progress }),
        Accumulate => from.animate(
            &to,
            Procedure::Accumulate {
                count: progress as u64,
            },
        ),
    };

    let output = unsafe { output.as_mut() }.expect("not a valid 'output' matrix");
    if let Ok(result) = result {
        *output = result.into();
    } else if progress < 0.5 {
        *output = from.clone().into();
    } else {
        *output = to.clone().into();
    }
}

#[no_mangle]
pub unsafe extern "C" fn Servo_ParseStyleAttribute(
    data: &nsACString,
    raw_extra_data: *mut URLExtraData,
    quirks_mode: nsCompatibility,
    loader: *mut Loader,
    rule_type: CssRuleType,
) -> Strong<LockedDeclarationBlock> {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let value = data.as_str_unchecked();
    let reporter = ErrorReporter::new(ptr::null_mut(), loader, raw_extra_data);
    let url_data = UrlExtraData::from_ptr_ref(&raw_extra_data);
    Arc::new(global_style_data.shared_lock.wrap(parse_style_attribute(
        value,
        url_data,
        reporter.as_ref().map(|r| r as &dyn ParseErrorReporter),
        quirks_mode.into(),
        rule_type,
    )))
    .into()
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_CreateEmpty() -> Strong<LockedDeclarationBlock> {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    Arc::new(
        global_style_data
            .shared_lock
            .wrap(PropertyDeclarationBlock::new()),
    )
    .into()
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_Clear(declarations: &LockedDeclarationBlock) {
    write_locked_arc(declarations, |decls: &mut PropertyDeclarationBlock| {
        decls.clear();
    });
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_Clone(
    declarations: &LockedDeclarationBlock,
) -> Strong<LockedDeclarationBlock> {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    Arc::new(
        global_style_data
            .shared_lock
            .wrap(declarations.read_with(&guard).clone()),
    )
    .into()
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_Equals(
    a: &LockedDeclarationBlock,
    b: &LockedDeclarationBlock,
) -> bool {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    a.read_with(&guard).declarations() == b.read_with(&guard).declarations()
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_GetCssText(
    declarations: &LockedDeclarationBlock,
    result: &mut nsACString,
) {
    read_locked_arc(declarations, |decls: &PropertyDeclarationBlock| {
        decls.to_css(result).unwrap()
    })
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_SerializeOneValue(
    decls: &LockedDeclarationBlock,
    property_id: &structs::AnimatedPropertyID,
    buffer: &mut nsACString,
    computed_values: Option<&ComputedValues>,
    data: &PerDocumentStyleData,
) {
    let property_id = get_property_id_from_animatedpropertyid!(property_id, ());

    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    let data = data.borrow();
    let rv = decls.read_with(&guard).single_value_to_css(
        &property_id,
        buffer,
        computed_values,
        &data.stylist,
    );
    debug_assert!(rv.is_ok());
}

#[no_mangle]
pub unsafe extern "C" fn Servo_SerializeFontValueForCanvas(
    declarations: &LockedDeclarationBlock,
    buffer: &mut nsACString,
) {
    use style::properties::shorthands::font;
    read_locked_arc(declarations, |decls: &PropertyDeclarationBlock| {
        let longhands = match font::LonghandsToSerialize::from_iter(decls.declarations().iter()) {
            Ok(l) => l,
            Err(()) => {
                warn!("Unexpected property!");
                return;
            },
        };

        let rv = longhands.to_css(&mut CssWriter::new(buffer));
        debug_assert!(rv.is_ok());
    })
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_Count(declarations: &LockedDeclarationBlock) -> u32 {
    read_locked_arc(declarations, |decls: &PropertyDeclarationBlock| {
        decls.declarations().len() as u32
    })
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_GetNthProperty(
    declarations: &LockedDeclarationBlock,
    index: u32,
    result: &mut nsACString,
) -> bool {
    read_locked_arc(declarations, |decls: &PropertyDeclarationBlock| {
        if let Some(decl) = decls.declarations().get(index as usize) {
            result.assign(&decl.id().name());
            true
        } else {
            false
        }
    })
}

macro_rules! get_property_id_from_property {
    ($property: ident, $ret: expr) => {{
        let property = $property.as_str_unchecked();
        match PropertyId::parse_enabled_for_all_content(property) {
            Ok(property_id) => property_id,
            Err(_) => return $ret,
        }
    }};
}

unsafe fn get_property_value(
    declarations: &LockedDeclarationBlock,
    property_id: PropertyId,
    value: &mut nsACString,
) {
    // This callsite is hot enough that the lock acquisition shows up in profiles.
    // Using an unchecked read here improves our performance by ~10% on the
    // microbenchmark in bug 1355599.
    read_locked_arc_unchecked(declarations, |decls: &PropertyDeclarationBlock| {
        decls.property_value_to_css(&property_id, value).unwrap();
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_DeclarationBlock_GetPropertyValue(
    declarations: &LockedDeclarationBlock,
    property: &nsACString,
    value: &mut nsACString,
) {
    get_property_value(
        declarations,
        get_property_id_from_property!(property, ()),
        value,
    )
}

#[no_mangle]
pub unsafe extern "C" fn Servo_DeclarationBlock_GetPropertyValueById(
    declarations: &LockedDeclarationBlock,
    property: nsCSSPropertyID,
    value: &mut nsACString,
) {
    get_property_value(
        declarations,
        get_property_id_from_nscsspropertyid!(property, ()),
        value,
    )
}

#[no_mangle]
pub unsafe extern "C" fn Servo_DeclarationBlock_GetPropertyIsImportant(
    declarations: &LockedDeclarationBlock,
    property: &nsACString,
) -> bool {
    let property_id = get_property_id_from_property!(property, false);
    read_locked_arc(declarations, |decls: &PropertyDeclarationBlock| {
        decls.property_priority(&property_id).important()
    })
}

#[inline(always)]
fn set_property_to_declarations(
    non_custom_property_id: Option<NonCustomPropertyId>,
    block: &LockedDeclarationBlock,
    parsed_declarations: &mut SourcePropertyDeclaration,
    before_change_closure: DeclarationBlockMutationClosure,
    importance: Importance,
) -> bool {
    let mut updates = Default::default();
    let will_change = read_locked_arc(block, |decls: &PropertyDeclarationBlock| {
        decls.prepare_for_update(&parsed_declarations, importance, &mut updates)
    });
    if !will_change {
        return false;
    }

    before_change_closure.invoke(non_custom_property_id);
    write_locked_arc(block, |decls: &mut PropertyDeclarationBlock| {
        decls.update(parsed_declarations.drain(), importance, &mut updates)
    });
    true
}

fn set_property(
    declarations: &LockedDeclarationBlock,
    property_id: PropertyId,
    value: &nsACString,
    is_important: bool,
    data: &UrlExtraData,
    parsing_mode: ParsingMode,
    quirks_mode: QuirksMode,
    loader: *mut Loader,
    rule_type: CssRuleType,
    before_change_closure: DeclarationBlockMutationClosure,
) -> bool {
    let mut source_declarations = SourcePropertyDeclaration::default();
    let reporter = ErrorReporter::new(ptr::null_mut(), loader, data.ptr());
    let non_custom_property_id = property_id.non_custom_id();
    let result = parse_property_into(
        &mut source_declarations,
        property_id,
        value,
        Origin::Author,
        data,
        parsing_mode,
        quirks_mode,
        rule_type,
        reporter.as_ref().map(|r| r as &dyn ParseErrorReporter),
    );

    if result.is_err() {
        return false;
    }

    let importance = if is_important {
        Importance::Important
    } else {
        Importance::Normal
    };

    set_property_to_declarations(
        non_custom_property_id,
        declarations,
        &mut source_declarations,
        before_change_closure,
        importance,
    )
}

#[no_mangle]
pub unsafe extern "C" fn Servo_DeclarationBlock_SanitizeForCanvas(
    declarations: &LockedDeclarationBlock,
) {
    use style::properties::PropertyDeclaration;
    use style::values::specified::{LineHeight, XTextScale, Zoom};
    // From canvas spec, force to set line-height property to 'normal' font property.
    // Also, for compat, disable text scaling and CSS zoom.
    write_locked_arc(declarations, |decls: &mut PropertyDeclarationBlock| {
        decls.push(PropertyDeclaration::LineHeight(LineHeight::Normal), Importance::Normal);
        decls.push(PropertyDeclaration::Zoom(Zoom::Document), Importance::Normal);
        decls.push(PropertyDeclaration::XTextScale(XTextScale::None), Importance::Normal);
    });
}

#[no_mangle]
pub unsafe extern "C" fn Servo_DeclarationBlock_SetProperty(
    declarations: &LockedDeclarationBlock,
    property: &nsACString,
    value: &nsACString,
    is_important: bool,
    data: *mut URLExtraData,
    parsing_mode: ParsingMode,
    quirks_mode: nsCompatibility,
    loader: *mut Loader,
    rule_type: CssRuleType,
    before_change_closure: DeclarationBlockMutationClosure,
) -> bool {
    set_property(
        declarations,
        get_property_id_from_property!(property, false),
        value,
        is_important,
        UrlExtraData::from_ptr_ref(&data),
        parsing_mode,
        quirks_mode.into(),
        loader,
        rule_type,
        before_change_closure,
    )
}

#[no_mangle]
pub unsafe extern "C" fn Servo_DeclarationBlock_SetPropertyToAnimationValue(
    declarations: &LockedDeclarationBlock,
    animation_value: &AnimationValue,
    before_change_closure: DeclarationBlockMutationClosure,
) -> bool {
    let non_custom_property_id = match animation_value.id() {
        PropertyDeclarationId::Longhand(id) => Some(id.into()),
        PropertyDeclarationId::Custom(_) => None,
    };
    let mut source_declarations = SourcePropertyDeclaration::with_one(animation_value.uncompute());

    set_property_to_declarations(
        non_custom_property_id,
        declarations,
        &mut source_declarations,
        before_change_closure,
        Importance::Normal,
    )
}

#[no_mangle]
pub unsafe extern "C" fn Servo_DeclarationBlock_SetPropertyById(
    declarations: &LockedDeclarationBlock,
    property: nsCSSPropertyID,
    value: &nsACString,
    is_important: bool,
    data: *mut URLExtraData,
    parsing_mode: ParsingMode,
    quirks_mode: nsCompatibility,
    loader: *mut Loader,
    rule_type: CssRuleType,
    before_change_closure: DeclarationBlockMutationClosure,
) -> bool {
    set_property(
        declarations,
        get_property_id_from_nscsspropertyid!(property, false),
        value,
        is_important,
        UrlExtraData::from_ptr_ref(&data),
        parsing_mode,
        quirks_mode.into(),
        loader,
        rule_type,
        before_change_closure,
    )
}

fn remove_property(
    declarations: &LockedDeclarationBlock,
    property_id: PropertyId,
    before_change_closure: DeclarationBlockMutationClosure,
) -> bool {
    let first_declaration = read_locked_arc(declarations, |decls: &PropertyDeclarationBlock| {
        decls.first_declaration_to_remove(&property_id)
    });

    let first_declaration = match first_declaration {
        Some(i) => i,
        None => return false,
    };

    before_change_closure.invoke(property_id.non_custom_id());
    write_locked_arc(declarations, |decls: &mut PropertyDeclarationBlock| {
        decls.remove_property(&property_id, first_declaration)
    });

    true
}

#[no_mangle]
pub unsafe extern "C" fn Servo_DeclarationBlock_RemoveProperty(
    declarations: &LockedDeclarationBlock,
    property: &nsACString,
    before_change_closure: DeclarationBlockMutationClosure,
) -> bool {
    remove_property(
        declarations,
        get_property_id_from_property!(property, false),
        before_change_closure,
    )
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_RemovePropertyById(
    declarations: &LockedDeclarationBlock,
    property: nsCSSPropertyID,
    before_change_closure: DeclarationBlockMutationClosure,
) -> bool {
    remove_property(
        declarations,
        get_property_id_from_nscsspropertyid!(property, false),
        before_change_closure,
    )
}

#[no_mangle]
pub extern "C" fn Servo_MediaList_Create() -> Strong<LockedMediaList> {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    Arc::new(global_style_data.shared_lock.wrap(MediaList::empty())).into()
}

#[no_mangle]
pub extern "C" fn Servo_MediaList_DeepClone(list: &LockedMediaList) -> Strong<LockedMediaList> {
    let global_style_data = &*GLOBAL_STYLE_DATA;
    read_locked_arc(list, |list: &MediaList| {
        Arc::new(global_style_data.shared_lock.wrap(list.clone())).into()
    })
}

#[no_mangle]
pub extern "C" fn Servo_MediaList_Matches(
    list: &LockedMediaList,
    raw_data: &PerDocumentStyleData,
) -> bool {
    let per_doc_data = raw_data.borrow();
    read_locked_arc(list, |list: &MediaList| {
        list.evaluate(
            per_doc_data.stylist.device(),
            per_doc_data.stylist.quirks_mode(),
        )
    })
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_HasCSSWideKeyword(
    declarations: &LockedDeclarationBlock,
    property: nsCSSPropertyID,
) -> bool {
    let property_id = get_property_id_from_nscsspropertyid!(property, false);
    read_locked_arc(declarations, |decls: &PropertyDeclarationBlock| {
        decls.has_css_wide_keyword(&property_id)
    })
}

#[no_mangle]
pub extern "C" fn Servo_MediaList_GetText(list: &LockedMediaList, result: &mut nsACString) {
    read_locked_arc(list, |list: &MediaList| {
        list.to_css(&mut CssWriter::new(result)).unwrap();
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_MediaList_SetText(
    list: &LockedMediaList,
    text: &nsACString,
    caller_type: CallerType,
) {
    let text = text.as_str_unchecked();

    let mut input = ParserInput::new(&text);
    let mut parser = Parser::new(&mut input);
    let url_data = dummy_url_data();

    // TODO(emilio): If the need for `CallerType` appears in more places,
    // consider adding an explicit member in `ParserContext` instead of doing
    // this (or adding a dummy "chrome://" url data).
    //
    // For media query parsing it's effectively the same, so for now...
    let origin = match caller_type {
        CallerType::System => Origin::UserAgent,
        CallerType::NonSystem => Origin::Author,
    };

    let context = ParserContext::new(
        origin,
        url_data,
        Some(CssRuleType::Media),
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        /* namespaces = */ Default::default(),
        // TODO(emilio): Looks like error reporting could be useful here?
        None,
        None,
    );

    write_locked_arc(list, |list: &mut MediaList| {
        *list = MediaList::parse(&context, &mut parser);
    })
}

#[no_mangle]
pub extern "C" fn Servo_MediaList_IsViewportDependent(list: &LockedMediaList) -> bool {
    read_locked_arc(list, |list: &MediaList| list.is_viewport_dependent())
}

#[no_mangle]
pub extern "C" fn Servo_MediaList_GetLength(list: &LockedMediaList) -> u32 {
    read_locked_arc(list, |list: &MediaList| list.media_queries.len() as u32)
}

#[no_mangle]
pub extern "C" fn Servo_MediaList_GetMediumAt(
    list: &LockedMediaList,
    index: u32,
    result: &mut nsACString,
) -> bool {
    read_locked_arc(list, |list: &MediaList| {
        let media_query = match list.media_queries.get(index as usize) {
            Some(mq) => mq,
            None => return false,
        };
        media_query.to_css(&mut CssWriter::new(result)).unwrap();
        true
    })
}

#[no_mangle]
pub extern "C" fn Servo_MediaList_AppendMedium(list: &LockedMediaList, new_medium: &nsACString) {
    let new_medium = unsafe { new_medium.as_str_unchecked() };
    let url_data = unsafe { dummy_url_data() };
    let context = ParserContext::new(
        Origin::Author,
        url_data,
        Some(CssRuleType::Media),
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        /* namespaces = */ Default::default(),
        None,
        None,
    );
    write_locked_arc(list, |list: &mut MediaList| {
        list.append_medium(&context, new_medium);
    })
}

#[no_mangle]
pub extern "C" fn Servo_MediaList_DeleteMedium(
    list: &LockedMediaList,
    old_medium: &nsACString,
) -> bool {
    let old_medium = unsafe { old_medium.as_str_unchecked() };
    let url_data = unsafe { dummy_url_data() };
    let context = ParserContext::new(
        Origin::Author,
        url_data,
        Some(CssRuleType::Media),
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        /* namespaces = */ Default::default(),
        None,
        None,
    );
    write_locked_arc(list, |list: &mut MediaList| {
        list.delete_medium(&context, old_medium)
    })
}

#[no_mangle]
pub extern "C" fn Servo_MediaList_SizeOfIncludingThis(
    malloc_size_of: GeckoMallocSizeOf,
    malloc_enclosing_size_of: GeckoMallocSizeOf,
    list: &LockedMediaList,
) -> usize {
    use malloc_size_of::MallocSizeOf;
    use malloc_size_of::MallocUnconditionalShallowSizeOf;

    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();

    let mut ops = MallocSizeOfOps::new(
        malloc_size_of.unwrap(),
        Some(malloc_enclosing_size_of.unwrap()),
        None,
    );

    unsafe { ArcBorrow::from_ref(list) }.with_arc(|list| {
        let mut n = 0;
        n += list.unconditional_shallow_size_of(&mut ops);
        n += list.read_with(&guard).size_of(&mut ops);
        n
    })
}

macro_rules! get_longhand_from_id {
    ($id:expr) => {
        match LonghandId::from_nscsspropertyid($id) {
            Some(lh) => lh,
            _ => panic!("stylo: unknown presentation property with id"),
        }
    };
}

macro_rules! match_wrap_declared {
    ($longhand:ident, $($property:ident => $inner:expr,)*) => (
        match $longhand {
            $(
                LonghandId::$property => PropertyDeclaration::$property($inner),
            )*
            _ => {
                panic!("stylo: Don't know how to handle presentation property");
            }
        }
    )
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_PropertyIsSet(
    declarations: &LockedDeclarationBlock,
    property: nsCSSPropertyID,
) -> bool {
    read_locked_arc(declarations, |decls: &PropertyDeclarationBlock| {
        decls.contains(PropertyDeclarationId::Longhand(get_longhand_from_id!(
            property
        )))
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_DeclarationBlock_SetIdentStringValue(
    declarations: &LockedDeclarationBlock,
    property: nsCSSPropertyID,
    value: *mut nsAtom,
) {
    use style::properties::longhands::_x_lang::computed_value::T as Lang;
    use style::properties::PropertyDeclaration;

    let long = get_longhand_from_id!(property);
    let prop = match_wrap_declared! { long,
        XLang => Lang(Atom::from_raw(value)),
    };
    write_locked_arc(declarations, |decls: &mut PropertyDeclarationBlock| {
        decls.push(prop, Importance::Normal);
    })
}

#[no_mangle]
#[allow(unreachable_code)]
pub extern "C" fn Servo_DeclarationBlock_SetKeywordValue(
    declarations: &LockedDeclarationBlock,
    property: nsCSSPropertyID,
    value: i32,
) {
    use num_traits::FromPrimitive;
    use style::properties::longhands;
    use style::properties::PropertyDeclaration;
    use style::values::generics::box_::{VerticalAlign, VerticalAlignKeyword};
    use style::values::generics::font::FontStyle;
    use style::values::specified::{
        table::CaptionSide, BorderStyle, Clear, Display, Float, TextAlign, TextEmphasisPosition,
        TextTransform,
    };

    fn get_from_computed<T>(value: u32) -> T
    where
        T: ToComputedValue,
        T::ComputedValue: FromPrimitive,
    {
        T::from_computed_value(&T::ComputedValue::from_u32(value).unwrap())
    }

    let long = get_longhand_from_id!(property);
    let value = value as u32;

    let prop = match_wrap_declared! { long,
        MozUserModify => longhands::_moz_user_modify::SpecifiedValue::from_gecko_keyword(value),
        Direction => get_from_computed::<longhands::direction::SpecifiedValue>(value),
        Display => get_from_computed::<Display>(value),
        Float => get_from_computed::<Float>(value),
        Clear => get_from_computed::<Clear>(value),
        VerticalAlign => VerticalAlign::Keyword(VerticalAlignKeyword::from_u32(value).unwrap()),
        TextAlign => get_from_computed::<TextAlign>(value),
        TextEmphasisPosition => TextEmphasisPosition::from_bits_retain(value as u8),
        FontSize => {
            // We rely on Gecko passing in font-size values (0...7) here.
            longhands::font_size::SpecifiedValue::from_html_size(value as u8)
        },
        FontStyle => {
            style::values::specified::FontStyle::Specified(if value == structs::NS_FONT_STYLE_ITALIC {
                FontStyle::Italic
            } else {
                debug_assert_eq!(value, structs::NS_FONT_STYLE_NORMAL);
                FontStyle::Normal
            })
        },
        FontWeight => longhands::font_weight::SpecifiedValue::from_gecko_keyword(value),
        ListStyleType => longhands::list_style_type::SpecifiedValue::from_gecko_keyword(value),
        MathStyle => longhands::math_style::SpecifiedValue::from_gecko_keyword(value),
        MozMathVariant => longhands::_moz_math_variant::SpecifiedValue::from_gecko_keyword(value),
        WhiteSpaceCollapse => get_from_computed::<longhands::white_space_collapse::SpecifiedValue>(value),
        TextWrapMode => get_from_computed::<longhands::text_wrap_mode::SpecifiedValue>(value),
        CaptionSide => get_from_computed::<CaptionSide>(value),
        BorderTopStyle => get_from_computed::<BorderStyle>(value),
        BorderRightStyle => get_from_computed::<BorderStyle>(value),
        BorderBottomStyle => get_from_computed::<BorderStyle>(value),
        BorderLeftStyle => get_from_computed::<BorderStyle>(value),
        TextTransform => {
            debug_assert_eq!(value, 0);
            TextTransform::NONE
        },
    };
    write_locked_arc(declarations, |decls: &mut PropertyDeclarationBlock| {
        decls.push(prop, Importance::Normal);
    })
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_SetIntValue(
    declarations: &LockedDeclarationBlock,
    property: nsCSSPropertyID,
    value: i32,
) {
    use style::properties::PropertyDeclaration;
    use style::values::specified::Integer;

    let long = get_longhand_from_id!(property);
    let prop = match_wrap_declared! { long,
        XSpan => Integer::new(value),
    };
    write_locked_arc(declarations, |decls: &mut PropertyDeclarationBlock| {
        decls.push(prop, Importance::Normal);
    })
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_SetMathDepthValue(
    declarations: &LockedDeclarationBlock,
    value: i32,
    is_relative: bool,
) {
    use style::properties::longhands::math_depth::SpecifiedValue as MathDepth;
    use style::properties::PropertyDeclaration;

    let integer_value = style::values::specified::Integer::new(value);
    let prop = PropertyDeclaration::MathDepth(if is_relative {
        MathDepth::Add(integer_value)
    } else {
        MathDepth::Absolute(integer_value)
    });
    write_locked_arc(declarations, |decls: &mut PropertyDeclarationBlock| {
        decls.push(prop, Importance::Normal);
    })
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_SetCounterResetListItem(
    declarations: &LockedDeclarationBlock,
    counter_value: i32,
    is_reversed: bool,
) {
    use style::properties::PropertyDeclaration;
    use style::values::generics::counters::{CounterPair, CounterReset};

    let prop = PropertyDeclaration::CounterReset(CounterReset::new(vec![CounterPair {
        name: CustomIdent(atom!("list-item")),
        value: style::values::specified::Integer::new(counter_value),
        is_reversed,
    }]));
    write_locked_arc(declarations, |decls: &mut PropertyDeclarationBlock| {
        decls.push(prop, Importance::Normal);
    })
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_SetCounterSetListItem(
    declarations: &LockedDeclarationBlock,
    counter_value: i32,
) {
    use style::properties::PropertyDeclaration;
    use style::values::generics::counters::{CounterPair, CounterSet};

    let prop = PropertyDeclaration::CounterSet(CounterSet::new(vec![CounterPair {
        name: CustomIdent(atom!("list-item")),
        value: style::values::specified::Integer::new(counter_value),
        is_reversed: false,
    }]));
    write_locked_arc(declarations, |decls: &mut PropertyDeclarationBlock| {
        decls.push(prop, Importance::Normal);
    })
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_SetPixelValue(
    declarations: &LockedDeclarationBlock,
    property: nsCSSPropertyID,
    value: f32,
) {
    use style::properties::longhands::border_spacing::SpecifiedValue as BorderSpacing;
    use style::properties::PropertyDeclaration;
    use style::values::generics::length::{LengthPercentageOrAuto, Size};
    use style::values::generics::NonNegative;
    use style::values::specified::length::{
        LengthPercentage, NonNegativeLength, NonNegativeLengthPercentage,
    };
    use style::values::specified::{BorderCornerRadius, BorderSideWidth};

    let long = get_longhand_from_id!(property);
    let nocalc = NoCalcLength::from_px(value);
    let lp = LengthPercentage::Length(nocalc);
    let lp_or_auto = LengthPercentageOrAuto::LengthPercentage(lp.clone());
    let prop = match_wrap_declared! { long,
        Height => Size::LengthPercentage(NonNegative(lp)),
        Width => Size::LengthPercentage(NonNegative(lp)),
        BorderTopWidth => BorderSideWidth::from_px(value),
        BorderRightWidth => BorderSideWidth::from_px(value),
        BorderBottomWidth => BorderSideWidth::from_px(value),
        BorderLeftWidth => BorderSideWidth::from_px(value),
        MarginTop => lp_or_auto,
        MarginRight => lp_or_auto,
        MarginBottom => lp_or_auto,
        MarginLeft => lp_or_auto,
        PaddingTop => NonNegative(lp),
        PaddingRight => NonNegative(lp),
        PaddingBottom => NonNegative(lp),
        PaddingLeft => NonNegative(lp),
        BorderSpacing => {
            let v = NonNegativeLength::from(nocalc);
            Box::new(BorderSpacing::new(v.clone(), v))
        },
        BorderTopLeftRadius => {
            let length = NonNegativeLengthPercentage::from(nocalc);
            Box::new(BorderCornerRadius::new(length.clone(), length))
        },
        BorderTopRightRadius => {
            let length = NonNegativeLengthPercentage::from(nocalc);
            Box::new(BorderCornerRadius::new(length.clone(), length))
        },
        BorderBottomLeftRadius => {
            let length = NonNegativeLengthPercentage::from(nocalc);
            Box::new(BorderCornerRadius::new(length.clone(), length))
        },
        BorderBottomRightRadius => {
            let length = NonNegativeLengthPercentage::from(nocalc);
            Box::new(BorderCornerRadius::new(length.clone(), length))
        },
    };
    write_locked_arc(declarations, |decls: &mut PropertyDeclarationBlock| {
        decls.push(prop, Importance::Normal);
    })
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_SetLengthValue(
    declarations: &LockedDeclarationBlock,
    property: nsCSSPropertyID,
    value: f32,
    unit: structs::nsCSSUnit,
) {
    use style::properties::PropertyDeclaration;
    use style::values::generics::length::{LengthPercentageOrAuto, Size};
    use style::values::generics::NonNegative;
    use style::values::specified::length::{
        FontRelativeLength, LengthPercentage, ViewportPercentageLength,
    };
    use style::values::specified::FontSize;

    let long = get_longhand_from_id!(property);
    let nocalc = match unit {
        structs::nsCSSUnit::eCSSUnit_EM => {
            NoCalcLength::FontRelative(FontRelativeLength::Em(value))
        },
        structs::nsCSSUnit::eCSSUnit_XHeight => {
            NoCalcLength::FontRelative(FontRelativeLength::Ex(value))
        },
        structs::nsCSSUnit::eCSSUnit_RootEM => {
            NoCalcLength::FontRelative(FontRelativeLength::Rem(value))
        },
        structs::nsCSSUnit::eCSSUnit_Char => {
            NoCalcLength::FontRelative(FontRelativeLength::Ch(value))
        },
        structs::nsCSSUnit::eCSSUnit_Ideographic => {
            NoCalcLength::FontRelative(FontRelativeLength::Ic(value))
        },
        structs::nsCSSUnit::eCSSUnit_CapHeight => {
            NoCalcLength::FontRelative(FontRelativeLength::Cap(value))
        },
        structs::nsCSSUnit::eCSSUnit_LineHeight => {
            NoCalcLength::FontRelative(FontRelativeLength::Lh(value))
        },
        structs::nsCSSUnit::eCSSUnit_RootLineHeight => {
            NoCalcLength::FontRelative(FontRelativeLength::Rlh(value))
        },
        structs::nsCSSUnit::eCSSUnit_Pixel => NoCalcLength::Absolute(AbsoluteLength::Px(value)),
        structs::nsCSSUnit::eCSSUnit_Inch => NoCalcLength::Absolute(AbsoluteLength::In(value)),
        structs::nsCSSUnit::eCSSUnit_Centimeter => {
            NoCalcLength::Absolute(AbsoluteLength::Cm(value))
        },
        structs::nsCSSUnit::eCSSUnit_Millimeter => {
            NoCalcLength::Absolute(AbsoluteLength::Mm(value))
        },
        structs::nsCSSUnit::eCSSUnit_Point => NoCalcLength::Absolute(AbsoluteLength::Pt(value)),
        structs::nsCSSUnit::eCSSUnit_Pica => NoCalcLength::Absolute(AbsoluteLength::Pc(value)),
        structs::nsCSSUnit::eCSSUnit_Quarter => NoCalcLength::Absolute(AbsoluteLength::Q(value)),
        structs::nsCSSUnit::eCSSUnit_VW => {
            NoCalcLength::ViewportPercentage(ViewportPercentageLength::Vw(value))
        },
        structs::nsCSSUnit::eCSSUnit_VH => {
            NoCalcLength::ViewportPercentage(ViewportPercentageLength::Vh(value))
        },
        structs::nsCSSUnit::eCSSUnit_VMin => {
            NoCalcLength::ViewportPercentage(ViewportPercentageLength::Vmin(value))
        },
        structs::nsCSSUnit::eCSSUnit_VMax => {
            NoCalcLength::ViewportPercentage(ViewportPercentageLength::Vmax(value))
        },
        _ => unreachable!("Unknown unit passed to SetLengthValue"),
    };

    let prop = match_wrap_declared! { long,
        Width => Size::LengthPercentage(NonNegative(LengthPercentage::Length(nocalc))),
        Height => Size::LengthPercentage(NonNegative(LengthPercentage::Length(nocalc))),
        X =>  LengthPercentage::Length(nocalc),
        Y =>  LengthPercentage::Length(nocalc),
        Cx => LengthPercentage::Length(nocalc),
        Cy => LengthPercentage::Length(nocalc),
        R =>  NonNegative(LengthPercentage::Length(nocalc)),
        Rx => LengthPercentageOrAuto::LengthPercentage(NonNegative(LengthPercentage::Length(nocalc))),
        Ry => LengthPercentageOrAuto::LengthPercentage(NonNegative(LengthPercentage::Length(nocalc))),
        FontSize => FontSize::Length(LengthPercentage::Length(nocalc)),
    };
    write_locked_arc(declarations, |decls: &mut PropertyDeclarationBlock| {
        decls.push(prop, Importance::Normal);
    })
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_SetPathValue(
    declarations: &LockedDeclarationBlock,
    property: nsCSSPropertyID,
    path: &nsTArray<f32>,
) {
    use style::properties::PropertyDeclaration;
    use style::values::specified::DProperty;

    // 1. Decode the path data from SVG.
    let path = match specified::SVGPathData::decode_from_f32_array(path) {
        Ok(p) => p,
        Err(()) => return,
    };

    // 2. Set decoded path into style.
    let long = get_longhand_from_id!(property);
    let prop = match_wrap_declared! { long,
        D => if path.0.is_empty() { DProperty::None } else { DProperty::Path(path) },
    };
    write_locked_arc(declarations, |decls: &mut PropertyDeclarationBlock| {
        decls.push(prop, Importance::Normal);
    })
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_SetPercentValue(
    declarations: &LockedDeclarationBlock,
    property: nsCSSPropertyID,
    value: f32,
) {
    use style::properties::PropertyDeclaration;
    use style::values::computed::Percentage;
    use style::values::generics::length::{LengthPercentageOrAuto, Size};
    use style::values::generics::NonNegative;
    use style::values::specified::length::LengthPercentage;
    use style::values::specified::FontSize;

    let long = get_longhand_from_id!(property);
    let pc = Percentage(value);
    let lp = LengthPercentage::Percentage(pc);
    let lp_or_auto = LengthPercentageOrAuto::LengthPercentage(lp.clone());

    let prop = match_wrap_declared! { long,
        Height => Size::LengthPercentage(NonNegative(lp)),
        Width => Size::LengthPercentage(NonNegative(lp)),
        X =>  lp,
        Y =>  lp,
        Cx => lp,
        Cy => lp,
        R =>  NonNegative(lp),
        Rx => LengthPercentageOrAuto::LengthPercentage(NonNegative(lp)),
        Ry => LengthPercentageOrAuto::LengthPercentage(NonNegative(lp)),
        MarginTop => lp_or_auto,
        MarginRight => lp_or_auto,
        MarginBottom => lp_or_auto,
        MarginLeft => lp_or_auto,
        FontSize => FontSize::Length(LengthPercentage::Percentage(pc)),
    };
    write_locked_arc(declarations, |decls: &mut PropertyDeclarationBlock| {
        decls.push(prop, Importance::Normal);
    })
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_SetAutoValue(
    declarations: &LockedDeclarationBlock,
    property: nsCSSPropertyID,
) {
    use style::properties::PropertyDeclaration;
    use style::values::generics::length::{LengthPercentageOrAuto, Size};

    let long = get_longhand_from_id!(property);
    let auto = LengthPercentageOrAuto::Auto;

    let prop = match_wrap_declared! { long,
        Height => Size::auto(),
        Width => Size::auto(),
        MarginTop => auto,
        MarginRight => auto,
        MarginBottom => auto,
        MarginLeft => auto,
        AspectRatio => specified::AspectRatio::auto(),
    };
    write_locked_arc(declarations, |decls: &mut PropertyDeclarationBlock| {
        decls.push(prop, Importance::Normal);
    })
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_SetCurrentColor(
    declarations: &LockedDeclarationBlock,
    property: nsCSSPropertyID,
) {
    use style::properties::PropertyDeclaration;
    use style::values::specified::Color;

    let long = get_longhand_from_id!(property);
    let cc = Color::currentcolor();

    let prop = match_wrap_declared! { long,
        BorderTopColor => cc,
        BorderRightColor => cc,
        BorderBottomColor => cc,
        BorderLeftColor => cc,
    };
    write_locked_arc(declarations, |decls: &mut PropertyDeclarationBlock| {
        decls.push(prop, Importance::Normal);
    })
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_SetColorValue(
    declarations: &LockedDeclarationBlock,
    property: nsCSSPropertyID,
    value: structs::nscolor,
) {
    use style::gecko::values::convert_nscolor_to_absolute_color;
    use style::properties::longhands;
    use style::properties::PropertyDeclaration;
    use style::values::specified::Color;

    let long = get_longhand_from_id!(property);
    let rgba = convert_nscolor_to_absolute_color(value);
    let color = Color::from_absolute_color(rgba);

    let prop = match_wrap_declared! { long,
        BorderTopColor => color,
        BorderRightColor => color,
        BorderBottomColor => color,
        BorderLeftColor => color,
        Color => longhands::color::SpecifiedValue(color),
        BackgroundColor => color,
    };
    write_locked_arc(declarations, |decls: &mut PropertyDeclarationBlock| {
        decls.push(prop, Importance::Normal);
    })
}

#[no_mangle]
pub unsafe extern "C" fn Servo_DeclarationBlock_SetFontFamily(
    declarations: &LockedDeclarationBlock,
    value: &nsACString,
) {
    use style::properties::longhands::font_family::SpecifiedValue as FontFamily;
    use style::properties::PropertyDeclaration;

    let string = value.as_str_unchecked();
    let mut input = ParserInput::new(&string);
    let mut parser = Parser::new(&mut input);
    let context = ParserContext::new(
        Origin::Author,
        dummy_url_data(),
        Some(CssRuleType::Style),
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        /* namespaces = */ Default::default(),
        None,
        None,
    );
    let result = FontFamily::parse(&context, &mut parser);
    if let Ok(family) = result {
        if parser.is_exhausted() {
            let decl = PropertyDeclaration::FontFamily(family);
            write_locked_arc(declarations, |decls: &mut PropertyDeclarationBlock| {
                decls.push(decl, Importance::Normal);
            })
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn Servo_DeclarationBlock_SetBackgroundImage(
    declarations: &LockedDeclarationBlock,
    value: &nsACString,
    raw_extra_data: *mut URLExtraData,
) {
    use style::properties::longhands::background_image::SpecifiedValue as BackgroundImage;
    use style::properties::PropertyDeclaration;
    use style::stylesheets::CorsMode;
    use style::values::generics::image::Image;
    use style::values::specified::url::SpecifiedImageUrl;

    let url_data = UrlExtraData::from_ptr_ref(&raw_extra_data);
    let string = value.as_str_unchecked();
    let context = ParserContext::new(
        Origin::Author,
        url_data,
        Some(CssRuleType::Style),
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        /* namespaces = */ Default::default(),
        None,
        None,
    );
    let url = SpecifiedImageUrl::parse_from_string(string.into(), &context, CorsMode::None);
    let decl = PropertyDeclaration::BackgroundImage(BackgroundImage(vec![Image::Url(url)].into()));
    write_locked_arc(declarations, |decls: &mut PropertyDeclarationBlock| {
        decls.push(decl, Importance::Normal);
    });
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_SetTextDecorationColorOverride(
    declarations: &LockedDeclarationBlock,
) {
    use style::properties::PropertyDeclaration;
    use style::values::specified::text::TextDecorationLine;

    let decoration = TextDecorationLine::COLOR_OVERRIDE;
    let decl = PropertyDeclaration::TextDecorationLine(decoration);
    write_locked_arc(declarations, |decls: &mut PropertyDeclarationBlock| {
        decls.push(decl, Importance::Normal);
    })
}

#[no_mangle]
pub extern "C" fn Servo_DeclarationBlock_SetAspectRatio(
    declarations: &LockedDeclarationBlock,
    width: f32,
    height: f32,
) {
    use style::properties::PropertyDeclaration;
    use style::values::generics::position::AspectRatio;

    let decl = PropertyDeclaration::AspectRatio(AspectRatio::from_mapped_ratio(width, height));
    write_locked_arc(declarations, |decls: &mut PropertyDeclarationBlock| {
        decls.push(decl, Importance::Normal);
    })
}

#[no_mangle]
pub extern "C" fn Servo_CSSSupports2(property: &nsACString, value: &nsACString) -> bool {
    let id = unsafe { get_property_id_from_property!(property, false) };

    let mut declarations = SourcePropertyDeclaration::default();
    parse_property_into(
        &mut declarations,
        id,
        value,
        Origin::Author,
        unsafe { dummy_url_data() },
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        CssRuleType::Style,
        None,
    )
    .is_ok()
}

#[no_mangle]
pub extern "C" fn Servo_CSSSupports(
    cond: &nsACString,
    ua_origin: bool,
    chrome_sheet: bool,
    quirks: bool,
) -> bool {
    let condition = unsafe { cond.as_str_unchecked() };
    let mut input = ParserInput::new(&condition);
    let mut input = Parser::new(&mut input);
    let cond = match input.parse_entirely(parse_condition_or_declaration) {
        Ok(c) => c,
        Err(..) => return false,
    };

    let origin = if ua_origin {
        Origin::UserAgent
    } else {
        Origin::Author
    };
    let url_data = unsafe {
        if chrome_sheet {
            dummy_chrome_url_data()
        } else {
            dummy_url_data()
        }
    };
    let quirks_mode = if quirks {
        QuirksMode::Quirks
    } else {
        QuirksMode::NoQuirks
    };

    // NOTE(emilio): The supports API is not associated to any stylesheet,
    // so the fact that there is no namespace map here is fine.
    let context = ParserContext::new(
        origin,
        url_data,
        Some(CssRuleType::Style),
        ParsingMode::DEFAULT,
        quirks_mode,
        /* namespaces = */ Default::default(),
        None,
        None,
    );

    cond.eval(&context)
}

#[no_mangle]
pub extern "C" fn Servo_CSSSupportsForImport(after_rule: &nsACString) -> bool {
    let condition = unsafe { after_rule.as_str_unchecked() };
    let mut input = ParserInput::new(&condition);
    let mut input = Parser::new(&mut input);

    // NOTE(emilio): The supports API is not associated to any stylesheet,
    // so the fact that there is no namespace map here is fine.
    let mut context = ParserContext::new(
        Origin::Author,
        unsafe { dummy_url_data() },
        Some(CssRuleType::Style),
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        /* namespaces = */ Default::default(),
        None,
        None,
    );

    let (_layer, supports) = ImportRule::parse_layer_and_supports(&mut input, &mut context);

    supports.map_or(true, |s| s.enabled)
}

#[no_mangle]
pub unsafe extern "C" fn Servo_NoteExplicitHints(
    element: &RawGeckoElement,
    restyle_hint: RestyleHint,
    change_hint: nsChangeHint,
) {
    GeckoElement(element).note_explicit_hints(restyle_hint, change_hint);
}

#[no_mangle]
pub extern "C" fn Servo_TakeChangeHint(element: &RawGeckoElement, was_restyled: &mut bool) -> u32 {
    let element = GeckoElement(element);

    let damage = match element.mutate_data() {
        Some(mut data) => {
            *was_restyled = data.is_restyle();

            let damage = data.damage;
            data.clear_restyle_state();
            damage
        },
        None => {
            warn!("Trying to get change hint from unstyled element");
            *was_restyled = false;
            GeckoRestyleDamage::empty()
        },
    };

    debug!("Servo_TakeChangeHint: {:?}, damage={:?}", element, damage);
    // We'd like to return `nsChangeHint` here, but bindgen bitfield enums don't
    // work as return values with the Linux 32-bit ABI at the moment because
    // they wrap the value in a struct, so for now just unwrap it.
    damage.as_change_hint().0
}

#[no_mangle]
pub extern "C" fn Servo_ResolveStyle(element: &RawGeckoElement) -> Strong<ComputedValues> {
    let element = GeckoElement(element);
    debug!("Servo_ResolveStyle: {:?}", element);
    let data = element
        .borrow_data()
        .expect("Resolving style on unstyled element");

    debug_assert!(
        element.has_current_styles(&*data),
        "Resolving style on {:?} without current styles: {:?}",
        element,
        data
    );
    data.styles.primary().clone().into()
}

#[no_mangle]
pub extern "C" fn Servo_ResolveStyleLazily(
    element: &RawGeckoElement,
    pseudo_type: PseudoStyleType,
    functional_pseudo_parameter: *mut nsAtom,
    rule_inclusion: StyleRuleInclusion,
    snapshots: *const ServoElementSnapshotTable,
    cache_generation: u64,
    can_use_cache: bool,
    raw_data: &PerDocumentStyleData,
) -> Strong<ComputedValues> {
    debug_assert!(!snapshots.is_null());
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    let element = GeckoElement(element);
    let mut data = raw_data.borrow_mut();
    let data = &mut *data;
    let rule_inclusion = RuleInclusion::from(rule_inclusion);
    let pseudo_element = PseudoElement::from_pseudo_type(
        pseudo_type,
        get_functional_pseudo_parameter_atom(functional_pseudo_parameter),
    );

    let matching_fn = |pseudo: &PseudoElement| match pseudo_element {
        Some(ref p) => *pseudo == *p,
        _ => false,
    };

    if cache_generation != data.undisplayed_style_cache_generation {
        data.undisplayed_style_cache.clear();
        data.undisplayed_style_cache_generation = cache_generation;
    }

    let stylist = &data.stylist;
    let finish = |styles: &ElementStyles, is_probe: bool| -> Option<Arc<ComputedValues>> {
        match pseudo_element {
            Some(ref pseudo) => {
                get_pseudo_style(
                    &guard,
                    element,
                    pseudo,
                    rule_inclusion,
                    styles,
                    /* inherited_styles = */ None,
                    &stylist,
                    is_probe,
                    if pseudo.is_highlight() {
                        Some(&matching_fn)
                    } else {
                        None
                    },
                )
            },
            None => Some(styles.primary().clone()),
        }
    };

    let is_before_or_after = pseudo_element
        .as_ref()
        .map_or(false, |p| p.is_before_or_after());

    // In the common case we already have the style. Check that before setting
    // up all the computation machinery.
    //
    // Also, only probe in the ::before or ::after case, since their styles may
    // not be in the `ElementData`, given they may exist but not be applicable
    // to generate an actual pseudo-element (like, having a `content: none`).
    if rule_inclusion == RuleInclusion::All {
        let styles = element.borrow_data().and_then(|d| {
            if d.has_styles() {
                finish(&d.styles, is_before_or_after)
            } else {
                None
            }
        });
        if let Some(result) = styles {
            return result.into();
        }
        if pseudo_element.is_none() && can_use_cache {
            if let Some(style) = data.undisplayed_style_cache.get(&element.opaque()) {
                return style.clone().into();
            }
        }
    }

    // We don't have the style ready. Go ahead and compute it as necessary.
    let shared = create_shared_context(
        &global_style_data,
        &guard,
        &stylist,
        TraversalFlags::empty(),
        unsafe { &*snapshots },
    );
    let mut tlc = ThreadLocalStyleContext::new();
    let mut context = StyleContext {
        shared: &shared,
        thread_local: &mut tlc,
    };

    let styles = resolve_style(
        &mut context,
        element,
        rule_inclusion,
        pseudo_element.as_ref(),
        if can_use_cache {
            Some(&mut data.undisplayed_style_cache)
        } else {
            None
        },
    );

    finish(&styles, /* is_probe = */ false)
        .expect("We're not probing, so we should always get a style back")
        .into()
}

#[no_mangle]
pub extern "C" fn Servo_ResolveStartingStyle(
    element: &RawGeckoElement,
    snapshots: *const ServoElementSnapshotTable,
    raw_data: &PerDocumentStyleData,
) -> Strong<ComputedValues> {
    use style::style_resolver::{PseudoElementResolution, StyleResolverForElement};

    let doc_data = raw_data.borrow();
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    let shared = create_shared_context(
        &global_style_data,
        &guard,
        &doc_data.stylist,
        TraversalFlags::empty(),
        unsafe { &*snapshots },
    );
    let mut tlc = ThreadLocalStyleContext::new();
    let mut context = StyleContext {
        shared: &shared,
        thread_local: &mut tlc,
    };

    let element = GeckoElement(element);
    let mut resolver = StyleResolverForElement::new(
        element,
        &mut context,
        RuleInclusion::All,
        PseudoElementResolution::IfApplicable,
    );

    let starting_style = resolver.resolve_starting_style();
    starting_style.style.0.into()
}

#[no_mangle]
pub extern "C" fn Servo_ReparentStyle(
    style_to_reparent: &ComputedValues,
    parent_style: &ComputedValues,
    layout_parent_style: &ComputedValues,
    element: Option<&RawGeckoElement>,
    raw_data: &PerDocumentStyleData,
) -> Strong<ComputedValues> {
    use style::properties::FirstLineReparenting;

    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    let doc_data = raw_data.borrow();
    let inputs = CascadeInputs::new_from_style(style_to_reparent);
    let pseudo = style_to_reparent.pseudo();
    let element = element.map(GeckoElement);

    doc_data
        .stylist
        .cascade_style_and_visited(
            element,
            pseudo.as_ref(),
            inputs,
            &StylesheetGuards::same(&guard),
            Some(parent_style),
            Some(layout_parent_style),
            FirstLineReparenting::Yes { style_to_reparent },
            /* rule_cache = */ None,
            &mut RuleCacheConditions::default(),
        )
        .into()
}

#[cfg(feature = "gecko_debug")]
fn simulate_compute_values_failure(property: &PropertyValuePair) -> bool {
    let p = &property.mProperty;
    let id = get_property_id_from_animatedpropertyid!(p, false);
    id.as_shorthand().is_ok() && property.mSimulateComputeValuesFailure
}

#[cfg(not(feature = "gecko_debug"))]
fn simulate_compute_values_failure(_: &PropertyValuePair) -> bool {
    false
}

fn create_context_for_animation<'a>(
    per_doc_data: &'a PerDocumentStyleDataImpl,
    style: &'a ComputedValues,
    parent_style: Option<&'a ComputedValues>,
    for_smil_animation: bool,
    rule_cache_conditions: &'a mut RuleCacheConditions,
    container_size_query: ContainerSizeQuery<'a>,
) -> Context<'a> {
    Context::new_for_animation(
        StyleBuilder::for_animation(
            per_doc_data.stylist.device(),
            Some(&per_doc_data.stylist),
            style,
            parent_style,
        ),
        for_smil_animation,
        per_doc_data.stylist.quirks_mode(),
        rule_cache_conditions,
        container_size_query,
    )
}

struct PropertyAndIndex {
    property: PropertyId,
    index: usize,
}

struct PrioritizedPropertyIter<'a> {
    properties: &'a [PropertyValuePair],
    sorted_property_indices: Vec<PropertyAndIndex>,
    curr: usize,
}

impl<'a> PrioritizedPropertyIter<'a> {
    fn new(properties: &'a [PropertyValuePair]) -> PrioritizedPropertyIter {
        use style::values::animated::compare_property_priority;

        // If we fail to convert a nsCSSPropertyID into a PropertyId we
        // shouldn't fail outright but instead by treating that property as the
        // 'all' property we make it sort last.
        let mut sorted_property_indices: Vec<PropertyAndIndex> = properties
            .iter()
            .enumerate()
            .map(|(index, pair)| {
                let property = PropertyId::from_gecko_animated_property_id(&pair.mProperty)
                    .unwrap_or(PropertyId::NonCustom(ShorthandId::All.into()));
                PropertyAndIndex { property, index }
            })
            .collect();
        sorted_property_indices.sort_by(|a, b| compare_property_priority(&a.property, &b.property));

        PrioritizedPropertyIter {
            properties,
            sorted_property_indices,
            curr: 0,
        }
    }

    fn reset(&mut self) {
        self.curr = 0;
    }
}

impl<'a> Iterator for PrioritizedPropertyIter<'a> {
    type Item = &'a PropertyValuePair;

    fn next(&mut self) -> Option<&'a PropertyValuePair> {
        if self.curr >= self.sorted_property_indices.len() {
            return None;
        }
        self.curr += 1;
        Some(&self.properties[self.sorted_property_indices[self.curr - 1].index])
    }
}

#[no_mangle]
pub extern "C" fn Servo_GetComputedKeyframeValues(
    keyframes: &nsTArray<structs::Keyframe>,
    element: &RawGeckoElement,
    pseudo_type: PseudoStyleType,
    style: &ComputedValues,
    raw_data: &PerDocumentStyleData,
    computed_keyframes: &mut nsTArray<structs::ComputedKeyframeValues>,
) {
    use style::applicable_declarations::CascadePriority;
    use style::custom_properties::CustomPropertiesBuilder;
    use style::properties::PropertyDeclaration;
    let data = raw_data.borrow();
    let element = GeckoElement(element);
    let pseudo = PseudoElement::from_pseudo_type(pseudo_type, None);
    let parent_element = if pseudo.is_none() {
        element.inheritance_parent()
    } else {
        Some(element)
    };
    let parent_data = parent_element.as_ref().and_then(|e| e.borrow_data());
    let parent_style = parent_data
        .as_ref()
        .map(|d| d.styles.primary())
        .map(|x| &**x);

    let container_size_query =
        ContainerSizeQuery::for_element(element, parent_style, pseudo.is_some());
    let mut conditions = Default::default();
    let mut context = create_context_for_animation(
        &data,
        &style,
        parent_style,
        /* for_smil_animation = */ false,
        &mut conditions,
        container_size_query,
    );

    let restriction = pseudo.and_then(|p| p.property_restriction());

    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    let default_values = data.default_computed_values();

    for (index, keyframe) in keyframes.iter().enumerate() {
        let ref mut animation_values = computed_keyframes[index];

        let mut seen = PropertyDeclarationIdSet::default();
        let mut iter = PrioritizedPropertyIter::new(&keyframe.mPropertyValues);

        // FIXME (bug 1883255): This is pretty much a hack. Instead, the AnimatedValue should be
        // better integrated in the cascade.
        {
            let mut builder = CustomPropertiesBuilder::new_with_properties(
                &data.stylist,
                style.custom_properties().clone(),
                &mut context,
            );
            let priority = CascadePriority::same_tree_author_normal_at_root_layer();
            for property in &mut iter {
                let is_custom =
                    match PropertyId::from_gecko_animated_property_id(&property.mProperty) {
                        Some(PropertyId::Custom(..)) => true,
                        _ => false,
                    };
                if !is_custom {
                    break; // Custom props are guaranteed to sort earlier.
                }
                if property.mServoDeclarationBlock.mRawPtr.is_null() {
                    continue;
                }
                let declarations = unsafe { &*property.mServoDeclarationBlock.mRawPtr };
                let guard = declarations.read_with(&guard);
                for decl in guard.normal_declaration_iter() {
                    if let PropertyDeclaration::Custom(ref declaration) = *decl {
                        builder.cascade(declaration, priority);
                    }
                }
            }
            iter.reset();
            let _deferred = builder.build(DeferFontRelativeCustomPropertyResolution::No);
            debug_assert!(
                _deferred.is_none(),
                "Custom property processing deferred despite specifying otherwise?"
            );
        };

        let mut property_index = 0;
        for property in iter {
            if simulate_compute_values_failure(property) {
                continue;
            }

            let mut maybe_append_animation_value =
                |property: PropertyDeclarationId, value: Option<AnimationValue>| {
                    debug_assert!(!property.is_logical());
                    debug_assert!(property.is_animatable());

                    // 'display' is only animatable from SMIL
                    if property == PropertyDeclarationId::Longhand(LonghandId::Display) {
                        return;
                    }

                    // Skip restricted properties
                    if restriction.map_or(false, |r| !property.flags().contains(r)) {
                        return;
                    }

                    if seen.contains(property) {
                        return;
                    }
                    seen.insert(property);

                    animation_values.push(structs::PropertyStyleAnimationValuePair {
                        mProperty: property.to_gecko_animated_property_id(),
                        mValue: structs::AnimationValue {
                            mServo: value.map_or(structs::RefPtr::null(), |v| {
                                structs::RefPtr::from_arc(Arc::new(v))
                            }),
                        },
                    });
                    property_index += 1;
                };

            if property.mServoDeclarationBlock.mRawPtr.is_null() {
                if let Some(prop) =
                    OwnedPropertyDeclarationId::from_gecko_animated_property_id(&property.mProperty)
                {
                    maybe_append_animation_value(prop.as_borrowed(), None);
                }
                continue;
            }

            let declarations = unsafe { &*property.mServoDeclarationBlock.mRawPtr };
            let guard = declarations.read_with(&guard);
            let iter = guard.to_animation_value_iter(&mut context, &default_values);

            for value in iter {
                maybe_append_animation_value(value.id(), Some(value.clone()));
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn Servo_GetAnimationValues(
    declarations: &LockedDeclarationBlock,
    element: &RawGeckoElement,
    style: &ComputedValues,
    raw_data: &PerDocumentStyleData,
    animation_values: &mut nsTArray<structs::RefPtr<AnimationValue>>,
) {
    let data = raw_data.borrow();
    let element = GeckoElement(element);
    let parent_element = element.inheritance_parent();
    let parent_data = parent_element.as_ref().and_then(|e| e.borrow_data());
    let parent_style = parent_data
        .as_ref()
        .map(|d| d.styles.primary())
        .map(|x| &**x);

    let container_size_query =
        ContainerSizeQuery::for_element(element, None, /* is_pseudo = */ false);
    let mut conditions = Default::default();
    let mut context = create_context_for_animation(
        &data,
        &style,
        parent_style,
        /* for_smil_animation = */ true,
        &mut conditions,
        container_size_query,
    );

    let default_values = data.default_computed_values();
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();

    let guard = declarations.read_with(&guard);
    let iter = guard.to_animation_value_iter(&mut context, &default_values);
    animation_values.extend(iter.map(|v| structs::RefPtr::from_arc(Arc::new(v))));
}

#[no_mangle]
pub extern "C" fn Servo_AnimationValue_GetPropertyId(
    value: &AnimationValue,
    property_id: &mut structs::AnimatedPropertyID,
) {
    *property_id = value.id().to_gecko_animated_property_id();
}

#[no_mangle]
pub extern "C" fn Servo_AnimationValue_Compute(
    element: &RawGeckoElement,
    declarations: &LockedDeclarationBlock,
    style: &ComputedValues,
    raw_data: &PerDocumentStyleData,
) -> Strong<AnimationValue> {
    let data = raw_data.borrow();

    let element = GeckoElement(element);
    let parent_element = element.inheritance_parent();
    let parent_data = parent_element.as_ref().and_then(|e| e.borrow_data());
    let parent_style = parent_data
        .as_ref()
        .map(|d| d.styles.primary())
        .map(|x| &**x);

    let container_size_query =
        ContainerSizeQuery::for_element(element, None, /* is_pseudo = */ false);
    let mut conditions = Default::default();
    let mut context = create_context_for_animation(
        &data,
        style,
        parent_style,
        /* for_smil_animation = */ false,
        &mut conditions,
        container_size_query,
    );

    let default_values = data.default_computed_values();
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    // We only compute the first element in declarations.
    match declarations
        .read_with(&guard)
        .declaration_importance_iter()
        .next()
    {
        Some((decl, imp)) if imp == Importance::Normal => {
            let animation = AnimationValue::from_declaration(decl, &mut context, default_values);
            animation.map_or(Strong::null(), |value| Arc::new(value).into())
        },
        _ => Strong::null(),
    }
}

#[no_mangle]
pub extern "C" fn Servo_AssertTreeIsClean(root: &RawGeckoElement) {
    if !cfg!(feature = "gecko_debug") {
        panic!("Calling Servo_AssertTreeIsClean in release build");
    }

    let root = GeckoElement(root);
    debug!("Servo_AssertTreeIsClean: ");
    debug!("{:?}", ShowSubtreeData(root.as_node()));

    fn assert_subtree_is_clean<'le>(el: GeckoElement<'le>) {
        debug_assert!(
            !el.has_dirty_descendants() && !el.has_animation_only_dirty_descendants(),
            "{:?} has still dirty bit {:?} or animation-only dirty bit {:?}",
            el,
            el.has_dirty_descendants(),
            el.has_animation_only_dirty_descendants()
        );
        for child in el.traversal_children() {
            if let Some(child) = child.as_element() {
                assert_subtree_is_clean(child);
            }
        }
    }

    assert_subtree_is_clean(root);
}

#[no_mangle]
pub extern "C" fn Servo_IsWorkerThread() -> bool {
    thread_state::get().is_worker()
}

enum Offset {
    Zero,
    One,
}

fn property_value_pair_for(id: &PropertyDeclarationId) -> structs::PropertyValuePair {
    structs::PropertyValuePair {
        mProperty: id.to_gecko_animated_property_id(),
        mServoDeclarationBlock: structs::RefPtr::null(),
        #[cfg(feature = "gecko_debug")]
        mSimulateComputeValuesFailure: false,
    }
}

fn fill_in_missing_keyframe_values(
    all_properties: &PropertyDeclarationIdSet,
    timing_function: &ComputedTimingFunction,
    properties_at_offset: &PropertyDeclarationIdSet,
    offset: Offset,
    keyframes: &mut nsTArray<structs::Keyframe>,
) {
    // Return early if all animated properties are already set.
    if properties_at_offset.contains_all(all_properties) {
        return;
    }

    // Use auto for missing keyframes.
    // FIXME: This may be a spec issue in css-animations-2 because the spec says the default
    // keyframe-specific composite is replace, but web-animations-1 uses auto. Use auto now so we
    // use the value of animation-composition of the element, for missing keyframes.
    // https://github.com/w3c/csswg-drafts/issues/7476
    let composition = structs::CompositeOperationOrAuto::Auto;
    let keyframe = match offset {
        Offset::Zero => unsafe {
            &mut *bindings::Gecko_GetOrCreateInitialKeyframe(
                keyframes,
                timing_function,
                composition,
            )
        },
        Offset::One => unsafe {
            &mut *bindings::Gecko_GetOrCreateFinalKeyframe(
                keyframes,
                timing_function,
                composition,
            )
        },
    };

    // Append properties that have not been set at this offset.
    for property in all_properties.iter() {
        if !properties_at_offset.contains(property) {
            keyframe.mPropertyValues.push(property_value_pair_for(&property));
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn Servo_StyleSet_GetKeyframesForName(
    raw_data: &PerDocumentStyleData,
    element: &RawGeckoElement,
    style: &ComputedValues,
    name: *mut nsAtom,
    inherited_timing_function: &ComputedTimingFunction,
    keyframes: &mut nsTArray<structs::Keyframe>,
) -> bool {
    use style::gecko_bindings::structs::CompositeOperationOrAuto;
    use style::values::computed::AnimationComposition;

    debug_assert!(keyframes.len() == 0, "keyframes should be initially empty");

    let element = GeckoElement(element);
    let data = raw_data.borrow();
    let name = Atom::from_raw(name);

    let animation = match data.stylist.get_animation(&name, element) {
        Some(animation) => animation,
        None => return false,
    };

    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();

    let mut properties_set_at_current_offset = PropertyDeclarationIdSet::default();
    let mut properties_set_at_start = PropertyDeclarationIdSet::default();
    let mut properties_set_at_end = PropertyDeclarationIdSet::default();
    let mut has_complete_initial_keyframe = false;
    let mut has_complete_final_keyframe = false;
    let mut current_offset = -1.;

    let writing_mode = style.writing_mode;

    // Iterate over the keyframe rules backwards so we can drop overridden
    // properties (since declarations in later rules override those in earlier
    // ones).
    for step in animation.steps.iter().rev() {
        if step.start_percentage.0 != current_offset {
            properties_set_at_current_offset.clear();
            current_offset = step.start_percentage.0;
        }

        // Override timing_function if the keyframe has an animation-timing-function.
        let timing_function = match step.get_animation_timing_function(&guard) {
            Some(val) => val.to_computed_value_without_context(),
            None => (*inherited_timing_function).clone(),
        };

        // Override composite operation if the keyframe has an animation-composition.
        let composition =
            step.get_animation_composition(&guard)
                .map_or(CompositeOperationOrAuto::Auto, |val| match val {
                    AnimationComposition::Replace => CompositeOperationOrAuto::Replace,
                    AnimationComposition::Add => CompositeOperationOrAuto::Add,
                    AnimationComposition::Accumulate => CompositeOperationOrAuto::Accumulate,
                });

        // Look for an existing keyframe with the same offset, timing function, and compsition, or
        // else add a new keyframe at the beginning of the keyframe array.
        let keyframe = &mut *bindings::Gecko_GetOrCreateKeyframeAtStart(
            keyframes,
            step.start_percentage.0 as f32,
            &timing_function,
            composition,
        );

        match step.value {
            KeyframesStepValue::ComputedValues => {
                // In KeyframesAnimation::from_keyframes if there is no 0% or
                // 100% keyframe at all, we will create a 'ComputedValues' step
                // to represent that all properties animated by the keyframes
                // animation should be set to the underlying computed value for
                // that keyframe.
                let mut seen = PropertyDeclarationIdSet::default();
                for property in animation.properties_changed.iter() {
                    let property = property.to_physical(writing_mode);
                    if seen.contains(property) {
                        continue;
                    }
                    seen.insert(property);
                    keyframe.mPropertyValues.push(property_value_pair_for(&property));
                }
                if current_offset == 0.0 {
                    has_complete_initial_keyframe = true;
                } else if current_offset == 1.0 {
                    has_complete_final_keyframe = true;
                }
            },
            KeyframesStepValue::Declarations { ref block } => {
                let guard = block.read_with(&guard);

                // Filter out non-animatable properties and properties with
                // !important.
                //
                // Also, iterate in reverse to respect the source order in case
                // there are logical and physical longhands in the same block.
                for declaration in guard.normal_declaration_iter().rev() {
                    let id = declaration.id().to_physical(writing_mode);

                    // Skip non-animatable properties, including the 'display' property because
                    // although it is animatable from SMIL, it should not be animatable from CSS
                    // Animations.
                    if !id.is_animatable() ||
                        id == PropertyDeclarationId::Longhand(LonghandId::Display)
                    {
                        continue;
                    }

                    if properties_set_at_current_offset.contains(id) {
                        continue;
                    }

                    let mut pair = property_value_pair_for(&id);
                    pair.mServoDeclarationBlock.set_arc(Arc::new(
                        global_style_data
                            .shared_lock
                            .wrap(PropertyDeclarationBlock::with_one(
                                declaration.to_physical(writing_mode),
                                Importance::Normal,
                            )),
                    ));
                    keyframe.mPropertyValues.push(pair);

                    if current_offset == 0.0 {
                        properties_set_at_start.insert(id);
                    } else if current_offset == 1.0 {
                        properties_set_at_end.insert(id);
                    }
                    properties_set_at_current_offset.insert(id);
                }
            },
        }
    }

    let mut properties_changed = PropertyDeclarationIdSet::default();
    for property in animation.properties_changed.iter() {
        properties_changed.insert(property.to_physical(writing_mode));
    }

    // Append property values that are missing in the initial or the final keyframes.
    if !has_complete_initial_keyframe {
        fill_in_missing_keyframe_values(
            &properties_changed,
            inherited_timing_function,
            &properties_set_at_start,
            Offset::Zero,
            keyframes,
        );
    }
    if !has_complete_final_keyframe {
        fill_in_missing_keyframe_values(
            &properties_changed,
            inherited_timing_function,
            &properties_set_at_end,
            Offset::One,
            keyframes,
        );
    }
    true
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_GetFontFaceRules(
    raw_data: &PerDocumentStyleData,
    rules: &mut nsTArray<structs::nsFontFaceRuleContainer>,
) {
    let data = raw_data.borrow();
    debug_assert_eq!(rules.len(), 0);

    // Reversed iterator because Gecko expects rules to appear sorted
    // UserAgent first, Author last.
    let font_face_iter = data
        .stylist
        .iter_extra_data_origins_rev()
        .flat_map(|(d, o)| d.font_faces.iter().zip(iter::repeat(o)));

    rules.extend(font_face_iter.map(|(&(ref rule, _layer_id), origin)| {
        structs::nsFontFaceRuleContainer {
            mRule: structs::RefPtr::from_arc(rule.clone()),
            mOrigin: origin,
        }
    }))
}

// XXX Ideally this should return a Option<&LockedCounterStyleRule>,
// but we cannot, because the value from AtomicRefCell::borrow() can only
// live in this function, and thus anything derived from it cannot get the
// same lifetime as raw_data in parameter. See bug 1451543.
#[no_mangle]
pub unsafe extern "C" fn Servo_StyleSet_GetCounterStyleRule(
    raw_data: &PerDocumentStyleData,
    name: *mut nsAtom,
) -> *const LockedCounterStyleRule {
    let data = raw_data.borrow();
    Atom::with(name, |name| {
        data.stylist
            .iter_extra_data_origins()
            .find_map(|(d, _)| d.counter_styles.get(name))
            .map_or(ptr::null(), |rule| &**rule as *const _)
    })
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_BuildFontFeatureValueSet(
    raw_data: &PerDocumentStyleData,
) -> *mut gfxFontFeatureValueSet {
    let data = raw_data.borrow();

    let has_rule = data
        .stylist
        .iter_extra_data_origins()
        .any(|(d, _)| !d.font_feature_values.is_empty());

    if !has_rule {
        return ptr::null_mut();
    }

    let font_feature_values_iter = data
        .stylist
        .iter_extra_data_origins_rev()
        .flat_map(|(d, _)| d.font_feature_values.iter());

    let set = unsafe { Gecko_ConstructFontFeatureValueSet() };
    for &(ref rule, _) in font_feature_values_iter {
        rule.set_at_rules(set);
    }
    set
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_BuildFontPaletteValueSet(
    raw_data: &PerDocumentStyleData,
) -> *mut FontPaletteValueSet {
    let data = raw_data.borrow();

    let has_rule = data
        .stylist
        .iter_extra_data_origins()
        .any(|(d, _)| !d.font_palette_values.is_empty());

    if !has_rule {
        return ptr::null_mut();
    }

    let font_palette_values_iter = data
        .stylist
        .iter_extra_data_origins_rev()
        .flat_map(|(d, _)| d.font_palette_values.iter());

    let set = unsafe { Gecko_ConstructFontPaletteValueSet() };
    for &(ref rule, _) in font_palette_values_iter {
        rule.to_gecko_palette_value_set(set);
    }
    set
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_ResolveForDeclarations(
    raw_data: &PerDocumentStyleData,
    parent_style_context: Option<&ComputedValues>,
    declarations: &LockedDeclarationBlock,
) -> Strong<ComputedValues> {
    let doc_data = raw_data.borrow();
    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    let guards = StylesheetGuards::same(&guard);

    let parent_style = match parent_style_context {
        Some(parent) => &*parent,
        None => doc_data.default_computed_values(),
    };

    doc_data
        .stylist
        .compute_for_declarations::<GeckoElement>(&guards, parent_style, unsafe {
            Arc::from_raw_addrefed(declarations)
        })
        .into()
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_AddSizeOfExcludingThis(
    malloc_size_of: GeckoMallocSizeOf,
    malloc_enclosing_size_of: GeckoMallocSizeOf,
    sizes: *mut ServoStyleSetSizes,
    raw_data: &PerDocumentStyleData,
) {
    let data = raw_data.borrow_mut();
    let mut ops = MallocSizeOfOps::new(
        malloc_size_of.unwrap(),
        Some(malloc_enclosing_size_of.unwrap()),
        None,
    );
    let sizes = unsafe { sizes.as_mut() }.unwrap();
    data.add_size_of(&mut ops, sizes);
}

#[no_mangle]
pub extern "C" fn Servo_UACache_AddSizeOf(
    malloc_size_of: GeckoMallocSizeOf,
    malloc_enclosing_size_of: GeckoMallocSizeOf,
    sizes: *mut ServoStyleSetSizes,
) {
    let mut ops = MallocSizeOfOps::new(
        malloc_size_of.unwrap(),
        Some(malloc_enclosing_size_of.unwrap()),
        None,
    );
    let sizes = unsafe { sizes.as_mut() }.unwrap();
    add_size_of_ua_cache(&mut ops, sizes);
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_MightHaveAttributeDependency(
    raw_data: &PerDocumentStyleData,
    element: &RawGeckoElement,
    local_name: *mut nsAtom,
) -> bool {
    let data = raw_data.borrow();
    let element = GeckoElement(element);

    unsafe {
        AtomIdent::with(local_name, |atom| {
            data.stylist.any_applicable_rule_data(element, |data| {
                data.might_have_attribute_dependency(atom)
            })
        })
    }
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_MightHaveNthOfIDDependency(
    raw_data: &PerDocumentStyleData,
    element: &RawGeckoElement,
    old_id: *mut nsAtom,
    new_id: *mut nsAtom,
) -> bool {
    let data = raw_data.borrow();
    let element = GeckoElement(element);

    data.stylist.any_applicable_rule_data(element, |data| {
        [old_id, new_id]
            .iter()
            .filter(|id| !id.is_null())
            .any(|id| unsafe {
                AtomIdent::with(*id, |atom| data.might_have_nth_of_id_dependency(atom))
            }) ||
            data.might_have_nth_of_attribute_dependency(&AtomIdent(atom!("id")))
    })
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_MightHaveNthOfClassDependency(
    raw_data: &PerDocumentStyleData,
    element: &RawGeckoElement,
    snapshots: &ServoElementSnapshotTable,
) -> bool {
    let data = raw_data.borrow();
    let element = GeckoElement(element);

    data.stylist.any_applicable_rule_data(element, |data| {
        classes_changed(&element, snapshots)
            .iter()
            .any(|atom| data.might_have_nth_of_class_dependency(atom)) ||
            data.might_have_nth_of_attribute_dependency(&AtomIdent(atom!("class")))
    })
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_MightHaveNthOfAttributeDependency(
    raw_data: &PerDocumentStyleData,
    element: &RawGeckoElement,
    local_name: *mut nsAtom,
) -> bool {
    let data = raw_data.borrow();
    let element = GeckoElement(element);

    unsafe {
        AtomIdent::with(local_name, |atom| {
            data.stylist.any_applicable_rule_data(element, |data| {
                data.might_have_nth_of_attribute_dependency(atom)
            })
        })
    }
}

fn on_siblings_invalidated(element: GeckoElement) {
    let parent = element
        .traversal_parent()
        .expect("How could we invalidate siblings without a common parent?");
    unsafe {
        parent.set_dirty_descendants();
        bindings::Gecko_NoteDirtySubtreeForInvalidation(parent.0);
    }
}

fn restyle_for_nth_of(element: GeckoElement, flags: ElementSelectorFlags) {
    debug_assert!(
        !flags.is_empty(),
        "Calling restyle for nth but no relevant flag is set."
    );
    fn invalidate_siblings_of(
        element: GeckoElement,
        get_sibling: fn(GeckoElement) -> Option<GeckoElement>,
    ) {
        let mut sibling = get_sibling(element);
        while let Some(sib) = sibling {
            if let Some(mut data) = sib.mutate_data() {
                data.hint.insert(RestyleHint::restyle_subtree());
            }
            sibling = get_sibling(sib);
        }
    }

    if flags.intersects(ElementSelectorFlags::HAS_SLOW_SELECTOR) {
        invalidate_siblings_of(element, |e| e.prev_sibling_element());
    }
    if flags.intersects(ElementSelectorFlags::HAS_SLOW_SELECTOR_LATER_SIBLINGS) {
        invalidate_siblings_of(element, |e| e.next_sibling_element());
    }
    on_siblings_invalidated(element);
}

fn relative_selector_invalidated_at(element: GeckoElement, result: &InvalidationResult) {
    if result.has_invalidated_siblings() {
        on_siblings_invalidated(element);
    } else if result.has_invalidated_descendants() {
        unsafe { bindings::Gecko_NoteDirtySubtreeForInvalidation(element.0) };
    } else if result.has_invalidated_self() {
        unsafe { bindings::Gecko_NoteDirtyElement(element.0) };
        let flags = element
            .parent_element()
            .map_or(ElementSelectorFlags::empty(), |e| e.slow_selector_flags());
        // We invalidated up to the anchor, and it has a flag for nth-of invalidation.
        if !flags.is_empty() {
            restyle_for_nth_of(element, flags);
        }
    }
}

fn add_relative_selector_attribute_dependency<'a>(
    element: &GeckoElement<'a>,
    scope: &Option<OpaqueElement>,
    invalidation_map: &'a RelativeSelectorInvalidationMap,
    attribute: &AtomIdent,
    collector: &mut RelativeSelectorDependencyCollector<'a, GeckoElement<'a>>,
) {
    match invalidation_map
        .map
        .other_attribute_affecting_selectors
        .get(attribute)
    {
        Some(v) => {
            for dependency in v {
                collector.add_dependency(dependency, *element, *scope);
            }
        },
        None => (),
    };
}

fn inherit_relative_selector_search_direction(
    parent: Option<GeckoElement>,
    prev_sibling: Option<GeckoElement>,
) -> ElementSelectorFlags {
    let mut inherited = ElementSelectorFlags::empty();
    if let Some(parent) = parent {
        inherited |= parent
            .relative_selector_search_direction()
            .intersection(ElementSelectorFlags::RELATIVE_SELECTOR_SEARCH_DIRECTION_ANCESTOR);
    }
    if let Some(sibling) = prev_sibling {
        // Inherit both, for e.g. a sibling with `:has(~.sibling .descendant)`
        inherited |= sibling.relative_selector_search_direction().intersection(
            ElementSelectorFlags::RELATIVE_SELECTOR_SEARCH_DIRECTION_ANCESTOR_SIBLING,
        );
    }
    inherited
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_MaybeInvalidateRelativeSelectorIDDependency(
    raw_data: &PerDocumentStyleData,
    element: &RawGeckoElement,
    old_id: *mut nsAtom,
    new_id: *mut nsAtom,
    snapshots: &ServoElementSnapshotTable,
) {
    let data = raw_data.borrow();
    let element = GeckoElement(element);

    let quirks_mode: QuirksMode = data.stylist.quirks_mode();
    let invalidator = RelativeSelectorInvalidator {
        element,
        quirks_mode,
        snapshot_table: Some(snapshots),
        invalidated: relative_selector_invalidated_at,
        sibling_traversal_map: SiblingTraversalMap::default(),
        _marker: std::marker::PhantomData,
    };

    invalidator.invalidate_relative_selectors_for_this(
        &data.stylist,
        |element, scope, data, quirks_mode, collector| {
            let invalidation_map = data.relative_selector_invalidation_map();
            relative_selector_dependencies_for_id(
                old_id,
                new_id,
                element,
                scope,
                quirks_mode,
                &invalidation_map,
                collector,
            );
            add_relative_selector_attribute_dependency(
                element,
                &scope,
                invalidation_map,
                &AtomIdent(atom!("id")),
                collector,
            );
        },
    );
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_MaybeInvalidateRelativeSelectorClassDependency(
    raw_data: &PerDocumentStyleData,
    element: &RawGeckoElement,
    snapshots: &ServoElementSnapshotTable,
) {
    let data = raw_data.borrow();
    let element = GeckoElement(element);
    let quirks_mode: QuirksMode = data.stylist.quirks_mode();
    let invalidator = RelativeSelectorInvalidator {
        element,
        quirks_mode,
        snapshot_table: Some(snapshots),
        invalidated: relative_selector_invalidated_at,
        sibling_traversal_map: SiblingTraversalMap::default(),
        _marker: std::marker::PhantomData,
    };

    invalidator.invalidate_relative_selectors_for_this(
        &data.stylist,
        |element, scope, data, quirks_mode, mut collector| {
            let invalidation_map = data.relative_selector_invalidation_map();

            relative_selector_dependencies_for_class(
                &classes_changed(element, snapshots),
                &element,
                scope,
                quirks_mode,
                invalidation_map,
                collector,
            );
            add_relative_selector_attribute_dependency(
                element,
                &scope,
                invalidation_map,
                &AtomIdent(atom!("class")),
                &mut collector,
            );
        },
    );
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_MaybeInvalidateRelativeSelectorAttributeDependency(
    raw_data: &PerDocumentStyleData,
    element: &RawGeckoElement,
    local_name: *mut nsAtom,
    snapshots: &ServoElementSnapshotTable,
) {
    let data = raw_data.borrow();
    let element = GeckoElement(element);

    let quirks_mode: QuirksMode = data.stylist.quirks_mode();
    unsafe {
        AtomIdent::with(local_name, |atom| {
            let invalidator = RelativeSelectorInvalidator {
                element,
                quirks_mode,
                snapshot_table: Some(snapshots),
                invalidated: relative_selector_invalidated_at,
                sibling_traversal_map: SiblingTraversalMap::default(),
                _marker: std::marker::PhantomData,
            };

            invalidator.invalidate_relative_selectors_for_this(
                &data.stylist,
                |element, scope, data, _quirks_mode, mut collector| {
                    add_relative_selector_attribute_dependency(
                        element,
                        &scope,
                        data.relative_selector_invalidation_map(),
                        atom,
                        &mut collector,
                    );
                },
            );
        })
    }
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_MaybeInvalidateRelativeSelectorStateDependency(
    raw_data: &PerDocumentStyleData,
    element: &RawGeckoElement,
    state: u64,
    snapshots: &ServoElementSnapshotTable,
) {
    let element = GeckoElement(element);

    let state = match ElementState::from_bits(state) {
        Some(state) => state,
        None => return,
    };
    let data = raw_data.borrow();
    let quirks_mode: QuirksMode = data.stylist.quirks_mode();

    let invalidator = RelativeSelectorInvalidator {
        element,
        quirks_mode,
        snapshot_table: Some(snapshots),
        invalidated: relative_selector_invalidated_at,
        sibling_traversal_map: SiblingTraversalMap::default(),
        _marker: std::marker::PhantomData,
    };

    invalidator.invalidate_relative_selectors_for_this(
        &data.stylist,
        |element, scope, data, quirks_mode, collector| {
            let invalidation_map = data.relative_selector_invalidation_map();
            invalidation_map
                .map
                .state_affecting_selectors
                .lookup_with_additional(*element, quirks_mode, None, &[], state, |dependency| {
                    if !dependency.state.intersects(state) {
                        return true;
                    }
                    collector.add_dependency(&dependency.dep, *element, scope);
                    true
                });
        },
    );
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_MaybeInvalidateRelativeSelectorCustomStateDependency(
    raw_data: &PerDocumentStyleData,
    element: &RawGeckoElement,
    state: *mut nsAtom,
    snapshots: &ServoElementSnapshotTable,
) {
    let data = raw_data.borrow();
    let element = GeckoElement(element);

    let quirks_mode: QuirksMode = data.stylist.quirks_mode();
    let invalidator = RelativeSelectorInvalidator {
        element,
        quirks_mode,
        snapshot_table: Some(snapshots),
        invalidated: relative_selector_invalidated_at,
        sibling_traversal_map: SiblingTraversalMap::default(),
        _marker: std::marker::PhantomData,
    };

    invalidator.invalidate_relative_selectors_for_this(
        &data.stylist,
        |element, scope, data, _quirks_mode, collector| {
            let invalidation_map = data.relative_selector_invalidation_map();
            relative_selector_dependencies_for_custom_state(
                state,
                *element,
                scope,
                &invalidation_map,
                collector,
            );
        },
    );
}

fn invalidate_relative_selector_prev_sibling_side_effect(
    prev_sibling: GeckoElement,
    quirks_mode: QuirksMode,
    sibling_traversal_map: SiblingTraversalMap<GeckoElement>,
    stylist: &Stylist,
) {
    let invalidator = RelativeSelectorInvalidator {
        element: prev_sibling,
        quirks_mode,
        snapshot_table: None,
        invalidated: relative_selector_invalidated_at,
        sibling_traversal_map,
        _marker: std::marker::PhantomData,
    };
    invalidator.invalidate_relative_selectors_for_dom_mutation(
        false,
        &stylist,
        ElementSelectorFlags::empty(),
        DomMutationOperation::SideEffectPrevSibling,
    );
}

fn invalidate_relative_selector_next_sibling_side_effect(
    next_sibling: GeckoElement,
    quirks_mode: QuirksMode,
    sibling_traversal_map: SiblingTraversalMap<GeckoElement>,
    stylist: &Stylist,
) {
    let invalidator = RelativeSelectorInvalidator {
        element: next_sibling,
        quirks_mode,
        snapshot_table: None,
        invalidated: relative_selector_invalidated_at,
        sibling_traversal_map,
        _marker: std::marker::PhantomData,
    };
    invalidator.invalidate_relative_selectors_for_dom_mutation(
        false,
        &stylist,
        ElementSelectorFlags::empty(),
        DomMutationOperation::SideEffectNextSibling,
    );
}

fn invalidate_relative_selector_ts_dependency(
    stylist: &Stylist,
    element: GeckoElement,
    state: TSStateForInvalidation,
) {
    let quirks_mode = stylist.quirks_mode();

    let invalidator = RelativeSelectorInvalidator {
        element,
        quirks_mode,
        snapshot_table: None,
        invalidated: relative_selector_invalidated_at,
        sibling_traversal_map: SiblingTraversalMap::default(),
        _marker: std::marker::PhantomData,
    };

    invalidator.invalidate_relative_selectors_for_this(
        stylist,
        |element, scope, data, quirks_mode, collector| {
            let invalidation_map = data.relative_selector_invalidation_map();
            invalidation_map
                .ts_state_to_selector
                .lookup_with_additional(
                    *element,
                    quirks_mode,
                    None,
                    &[],
                    ElementState::empty(),
                    |dependency| {
                        if !dependency.state.intersects(state) {
                            return true;
                        }
                        collector.add_dependency(&dependency.dep, *element, scope);
                        true
                    },
                );
        },
    );
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_MaybeInvalidateRelativeSelectorEmptyDependency(
    raw_data: &PerDocumentStyleData,
    element: &RawGeckoElement,
) {
    invalidate_relative_selector_ts_dependency(
        &raw_data.borrow().stylist,
        GeckoElement(element),
        TSStateForInvalidation::EMPTY,
    );
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_MaybeInvalidateRelativeSelectorNthEdgeDependency(
    raw_data: &PerDocumentStyleData,
    element: &RawGeckoElement,
) {
    invalidate_relative_selector_ts_dependency(
        &raw_data.borrow().stylist,
        GeckoElement(element),
        TSStateForInvalidation::NTH_EDGE,
    );
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_MaybeInvalidateRelativeSelectorNthDependencyFromSibling(
    raw_data: &PerDocumentStyleData,
    element: &RawGeckoElement,
    force: bool,
) {
    let mut element = Some(GeckoElement(element));
    let data = unsafe { borrow_assert_main_thread(raw_data) };

    // Short of doing the actual matching, any of the siblings can match the selector, so we
    // have to try invalidating against all of them.
    while let Some(sibling) = element {
        if force {
            unsafe { sibling.note_explicit_hints(RestyleHint::restyle_subtree(), nsChangeHint(0)) };
        }
        invalidate_relative_selector_ts_dependency(&data.stylist, sibling, TSStateForInvalidation::NTH);
        element = sibling.next_sibling_element();
    }
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_MaybeInvalidateRelativeSelectorForInsertion(
    raw_data: &PerDocumentStyleData,
    element: &RawGeckoElement,
) {
    let element = GeckoElement(element);
    let data = raw_data.borrow();
    let quirks_mode: QuirksMode = data.stylist.quirks_mode();

    let inherited = inherit_relative_selector_search_direction(
        element.parent_element(),
        element.prev_sibling_element(),
    );
    // Technically, we're not handling breakouts, where the anchor is a (later-sibling) descendant.
    // For descendant case, we're ok since it's a descendant of an element yet to be styled.
    // For later-sibling descendant, `HAS_SLOW_SELECTOR_LATER_SIBLINGS` is set anyway.
    if inherited.is_empty() {
        return;
    }

    // Ok, we could've been inserted between two sibling elements that were connected
    // through next sibling. This can happen in two ways:
    // * `.a:has(+ .b)`
    // * `:has(.. .a + .b ..)`
    // Note that the previous sibling may be the anchor, and not part of the invalidation chain.
    // Either way, there must be siblings to both sides of the element being inserted
    // to consider it.
    match (
        element.prev_sibling_element(),
        element.next_sibling_element(),
    ) {
        (Some(prev_sibling), Some(next_sibling)) => 'sibling: {
            // If the prev sibling is not on the sibling search path, skip.
            if !prev_sibling
                .relative_selector_search_direction()
                .intersects(ElementSelectorFlags::RELATIVE_SELECTOR_SEARCH_DIRECTION_SIBLING)
            {
                break 'sibling;
            }
            element.apply_selector_flags(
                ElementSelectorFlags::RELATIVE_SELECTOR_SEARCH_DIRECTION_SIBLING,
            );
            invalidate_relative_selector_prev_sibling_side_effect(
                prev_sibling,
                quirks_mode,
                SiblingTraversalMap::new(
                    prev_sibling,
                    prev_sibling.prev_sibling_element(),
                    element.next_sibling_element(),
                ), // Pretend this inserted element isn't here.
                &data.stylist,
            );
            invalidate_relative_selector_next_sibling_side_effect(
                next_sibling,
                quirks_mode,
                SiblingTraversalMap::new(
                    next_sibling,
                    Some(prev_sibling),
                    next_sibling.next_sibling_element(),
                ),
                &data.stylist,
            );
        },
        _ => (),
    };

    let invalidator = RelativeSelectorInvalidator {
        element,
        quirks_mode,
        snapshot_table: None,
        invalidated: relative_selector_invalidated_at,
        sibling_traversal_map: SiblingTraversalMap::default(),
        _marker: std::marker::PhantomData,
    };

    invalidator.invalidate_relative_selectors_for_dom_mutation(
        true,
        &data.stylist,
        inherited,
        DomMutationOperation::Insert,
    );
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_MaybeInvalidateRelativeSelectorForAppend(
    raw_data: &PerDocumentStyleData,
    first_node: &RawGeckoNode,
) {
    let first_node = GeckoNode(first_node);
    let inherited = inherit_relative_selector_search_direction(
        first_node.parent_element(),
        first_node.prev_sibling_element(),
    );
    if inherited.is_empty() {
        return;
    }
    let first_element = if let Some(e) = first_node.as_element() {
        e
    } else if let Some(e) = first_node.next_sibling_element() {
        e
    } else {
        return;
    };
    let data = raw_data.borrow();
    let quirks_mode: QuirksMode = data.stylist.quirks_mode();

    let mut element = Some(first_element);
    while let Some(e) = element {
        let invalidator = RelativeSelectorInvalidator {
            element: e,
            quirks_mode,
            snapshot_table: None,
            sibling_traversal_map: SiblingTraversalMap::default(),
            invalidated: relative_selector_invalidated_at,
            _marker: std::marker::PhantomData,
        };
        invalidator.invalidate_relative_selectors_for_dom_mutation(
            true,
            &data.stylist,
            inherited,
            DomMutationOperation::Append,
        );
        element = e.next_sibling_element();
    }
}

fn get_siblings_of_element<'e>(
    element: GeckoElement<'e>,
    following_node: &'e Option<GeckoNode<'e>>,
) -> (Option<GeckoElement<'e>>, Option<GeckoElement<'e>>) {
    let node = match following_node {
        Some(n) => n,
        None => {
            return match element.as_node().parent_node() {
                Some(p) => (p.last_child_element(), None),
                None => (None, None),
            }
        },
    };

    (node.prev_sibling_element(), node.next_sibling_element())
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_MaybeInvalidateRelativeSelectorForRemoval(
    raw_data: &PerDocumentStyleData,
    element: &RawGeckoElement,
    following_node: Option<&RawGeckoNode>,
) {
    let element = GeckoElement(element);

    // This element was in-tree, so we can safely say that if it was not on
    // the relative selector search path, its removal will not invalidate any
    // relative selector.
    if element.relative_selector_search_direction().is_empty() {
        return;
    }
    let following_node = following_node.map(GeckoNode);
    let (prev_sibling, next_sibling) = get_siblings_of_element(element, &following_node);

    let inherited =
        inherit_relative_selector_search_direction(element.parent_element(), prev_sibling);
    if inherited.is_empty() {
        return;
    }

    let data = raw_data.borrow();
    let quirks_mode = data.stylist.quirks_mode();
    // Same comment as insertion applies.
    match (prev_sibling, next_sibling) {
        (Some(prev_sibling), Some(next_sibling)) => {
            invalidate_relative_selector_prev_sibling_side_effect(
                prev_sibling,
                quirks_mode,
                SiblingTraversalMap::default(),
                &data.stylist,
            );
            invalidate_relative_selector_next_sibling_side_effect(
                next_sibling,
                quirks_mode,
                SiblingTraversalMap::default(),
                &data.stylist,
            );
        },
        _ => (),
    };
    let invalidator = RelativeSelectorInvalidator {
        element,
        quirks_mode,
        snapshot_table: None,
        sibling_traversal_map: SiblingTraversalMap::new(element, prev_sibling, next_sibling),
        invalidated: relative_selector_invalidated_at,
        _marker: std::marker::PhantomData,
    };
    invalidator.invalidate_relative_selectors_for_dom_mutation(
        true,
        &data.stylist,
        inherited,
        DomMutationOperation::Remove,
    );
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_HasStateDependency(
    raw_data: &PerDocumentStyleData,
    element: &RawGeckoElement,
    state: u64,
) -> bool {
    let element = GeckoElement(element);

    let state = ElementState::from_bits_retain(state);
    let data = raw_data.borrow();

    data.stylist
        .any_applicable_rule_data(element, |data| data.has_state_dependency(state))
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_HasNthOfCustomStateDependency(
    raw_data: &PerDocumentStyleData,
    element: &RawGeckoElement,
    state: *mut nsAtom,
) -> bool {
    let element = GeckoElement(element);
    let data = raw_data.borrow();
    data.stylist
        .any_applicable_rule_data(element, |data| unsafe {
            AtomIdent::with(state, |atom| data.has_nth_of_custom_state_dependency(atom))
        })
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_HasNthOfStateDependency(
    raw_data: &PerDocumentStyleData,
    element: &RawGeckoElement,
    state: u64,
) -> bool {
    let element = GeckoElement(element);

    let state = ElementState::from_bits_retain(state);
    let data = raw_data.borrow();

    data.stylist
        .any_applicable_rule_data(element, |data| data.has_nth_of_state_dependency(state))
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_RestyleSiblingsForNthOf(element: &RawGeckoElement, flags: u32) {
    let flags = slow_selector_flags_from_node_selector_flags(flags);
    let element = GeckoElement(element);
    restyle_for_nth_of(element, flags);
}

#[no_mangle]
pub extern "C" fn Servo_StyleSet_HasDocumentStateDependency(
    raw_data: &PerDocumentStyleData,
    state: u64,
) -> bool {
    let state = DocumentState::from_bits_retain(state);
    let data = raw_data.borrow();

    data.stylist.has_document_state_dependency(state)
}

fn computed_or_resolved_value(
    style: &ComputedValues,
    prop: nsCSSPropertyID,
    context: Option<&resolved::Context>,
    value: &mut nsACString,
) {
    if let Some(longhand) = LonghandId::from_nscsspropertyid(prop) {
        return style
            .computed_or_resolved_value(longhand, context, value)
            .unwrap();
    }

    let shorthand =
        ShorthandId::from_nscsspropertyid(prop).expect("Not a shorthand nor a longhand?");
    let mut block = PropertyDeclarationBlock::new();
    for longhand in shorthand.longhands() {
        block.push(
            style.computed_or_resolved_declaration(longhand, context),
            Importance::Normal,
        );
    }
    block.shorthand_to_css(shorthand, value).unwrap();
}

#[no_mangle]
pub unsafe extern "C" fn Servo_GetComputedValue(
    style: &ComputedValues,
    prop: nsCSSPropertyID,
    value: &mut nsACString,
) {
    computed_or_resolved_value(style, prop, None, value)
}

#[no_mangle]
pub unsafe extern "C" fn Servo_GetResolvedValue(
    style: &ComputedValues,
    prop: nsCSSPropertyID,
    raw_data: &PerDocumentStyleData,
    element: &RawGeckoElement,
    value: &mut nsACString,
) {
    let data = raw_data.borrow();
    let device = data.stylist.device();
    let context = resolved::Context {
        style,
        device,
        element_info: resolved::ResolvedElementInfo {
            element: GeckoElement(element),
        },
    };

    computed_or_resolved_value(style, prop, Some(&context), value)
}

#[no_mangle]
pub unsafe extern "C" fn Servo_GetCustomPropertyValue(
    style: &ComputedValues,
    name: &nsACString,
    raw_data: &PerDocumentStyleData,
    value: &mut nsACString,
) -> bool {
    let data = raw_data.borrow();
    let name = Atom::from(name.as_str_unchecked());
    let custom_registration = data.stylist.get_custom_property_registration(&name);
    let computed_value = style.custom_properties.get(custom_registration, &name);
    let computed_value = match computed_value {
        Some(v) => v,
        None => return false,
    };
    // TODO(emilio): This might want to return resolved colors and so on for example, see
    // https://github.com/w3c/csswg-drafts/issues/10371.
    computed_value.to_css(&mut CssWriter::new(value)).unwrap();
    true
}

#[no_mangle]
pub extern "C" fn Servo_GetCustomPropertiesCount(computed_values: &ComputedValues) -> u32 {
    // Just expose the custom property items from custom_properties.inherited
    // and custom_properties.non_inherited.
    let properties = computed_values.custom_properties();
    properties.inherited.len() as u32 + properties.non_inherited.len() as u32
}

#[no_mangle]
pub extern "C" fn Servo_GetCustomPropertyNameAt(
    computed_values: &ComputedValues,
    index: u32,
) -> *mut nsAtom {
    match &computed_values
        .custom_properties
        .property_at(index as usize)
    {
        Some((name, _value)) => name.as_ptr(),
        None => ptr::null_mut(),
    }
}

#[no_mangle]
pub extern "C" fn Servo_CssUrl_IsLocalRef(url: &url::CssUrl) -> bool {
    url.is_fragment()
}

fn relative_selector_dependencies_for_id<'a>(
    old_id: *const nsAtom,
    new_id: *const nsAtom,
    element: &GeckoElement<'a>,
    scope: Option<OpaqueElement>,
    quirks_mode: QuirksMode,
    invalidation_map: &'a RelativeSelectorInvalidationMap,
    collector: &mut RelativeSelectorDependencyCollector<'a, GeckoElement<'a>>,
) {
    [old_id, new_id]
        .iter()
        .filter(|id| !id.is_null())
        .for_each(|id| unsafe {
            AtomIdent::with(*id, |atom| {
                match invalidation_map.map.id_to_selector.get(atom, quirks_mode) {
                    Some(v) => {
                        for dependency in v {
                            collector.add_dependency(dependency, *element, scope);
                        }
                    },
                    None => (),
                };
            })
        });
}

fn relative_selector_dependencies_for_class<'a>(
    classes_changed: &SmallVec<[Atom; 8]>,
    element: &GeckoElement<'a>,
    scope: Option<OpaqueElement>,
    quirks_mode: QuirksMode,
    invalidation_map: &'a RelativeSelectorInvalidationMap,
    collector: &mut RelativeSelectorDependencyCollector<'a, GeckoElement<'a>>,
) {
    classes_changed.iter().for_each(|atom| {
        match invalidation_map
            .map
            .class_to_selector
            .get(atom, quirks_mode)
        {
            Some(v) => {
                for dependency in v {
                    collector.add_dependency(dependency, *element, scope);
                }
            },
            None => (),
        };
    });
}

fn relative_selector_dependencies_for_custom_state<'a>(
    state: *const nsAtom,
    element: GeckoElement<'a>,
    scope: Option<OpaqueElement>,
    invalidation_map: &'a RelativeSelectorInvalidationMap,
    collector: &mut RelativeSelectorDependencyCollector<'a, GeckoElement<'a>>,
) {
    unsafe {
        AtomIdent::with(state, |atom| {
            match invalidation_map
                .map
                .custom_state_affecting_selectors
                .get(atom)
            {
                Some(v) => {
                    for dependency in v {
                        collector.add_dependency(dependency, element, scope);
                    }
                },
                None => (),
            };
        })
    }
}

fn process_relative_selector_invalidations(
    element: &GeckoElement,
    snapshot_table: &ServoElementSnapshotTable,
    data: &PerDocumentStyleDataImpl,
) {
    let snapshot = match snapshot_table.get(element) {
        None => return,
        Some(s) => s,
    };
    let mut states = None;
    let mut classes = None;

    let quirks_mode: QuirksMode = data.stylist.quirks_mode();
    let invalidator = RelativeSelectorInvalidator {
        element: *element,
        quirks_mode,
        invalidated: relative_selector_invalidated_at,
        sibling_traversal_map: SiblingTraversalMap::default(),
        snapshot_table: Some(snapshot_table),
        _marker: std::marker::PhantomData,
    };

    invalidator.invalidate_relative_selectors_for_this(
        &data.stylist,
        |element, scope, data, quirks_mode, collector| {
            let invalidation_map = data.relative_selector_invalidation_map();
            let states = *states.get_or_insert_with(|| {
                ElementWrapper::new(*element, snapshot_table).state_changes()
            });
            let classes = classes.get_or_insert_with(|| classes_changed(element, snapshot_table));
            if snapshot.id_changed() {
                relative_selector_dependencies_for_id(
                    element
                        .id()
                        .map(|id| id.as_ptr().cast_const())
                        .unwrap_or(ptr::null()),
                    snapshot
                        .id_attr()
                        .map(|id| id.as_ptr().cast_const())
                        .unwrap_or(ptr::null()),
                    element,
                    scope,
                    quirks_mode,
                    invalidation_map,
                    collector,
                );
            }
            relative_selector_dependencies_for_class(
                &classes,
                element,
                scope,
                quirks_mode,
                invalidation_map,
                collector,
            );
            snapshot.each_attr_changed(|attr| {
                add_relative_selector_attribute_dependency(
                    element,
                    &scope,
                    invalidation_map,
                    attr,
                    collector,
                )
            });
            invalidation_map
                .map
                .state_affecting_selectors
                .lookup_with_additional(*element, quirks_mode, None, &[], states, |dependency| {
                    if !dependency.state.intersects(states) {
                        return true;
                    }
                    collector.add_dependency(&dependency.dep, *element, scope);
                    true
                });
        },
    );
}

#[no_mangle]
pub extern "C" fn Servo_ProcessInvalidations(
    set: &PerDocumentStyleData,
    element: &RawGeckoElement,
    snapshots: *const ServoElementSnapshotTable,
) {
    debug_assert!(!snapshots.is_null());

    let element = GeckoElement(element);
    debug_assert!(element.has_snapshot());
    debug_assert!(!element.handled_snapshot());

    let snapshot_table = unsafe { &*snapshots };
    let per_doc_data = set.borrow();
    process_relative_selector_invalidations(&element, snapshot_table, &per_doc_data);

    let mut data = element.mutate_data();
    if data.is_none() {
        // Snapshot for unstyled element is really only meant for relative selector
        // invalidation, so this is fine.
        return;
    }

    let global_style_data = &*GLOBAL_STYLE_DATA;
    let guard = global_style_data.shared_lock.read();
    let per_doc_data = set.borrow();
    let shared_style_context = create_shared_context(
        &global_style_data,
        &guard,
        &per_doc_data.stylist,
        TraversalFlags::empty(),
        snapshot_table,
    );
    let mut data = data.as_mut().map(|d| &mut **d);

    let mut selector_caches = SelectorCaches::default();
    if let Some(ref mut data) = data {
        // FIXME(emilio): Ideally we could share the nth-index-cache across all
        // the elements?
        let result = data.invalidate_style_if_needed(
            element,
            &shared_style_context,
            None,
            &mut selector_caches,
        );

        if result.has_invalidated_siblings() {
            let parent = element
                .traversal_parent()
                .expect("How could we invalidate siblings without a common parent?");
            unsafe {
                parent.set_dirty_descendants();
                bindings::Gecko_NoteDirtySubtreeForInvalidation(parent.0);
            }
        } else if result.has_invalidated_descendants() {
            unsafe { bindings::Gecko_NoteDirtySubtreeForInvalidation(element.0) };
        } else if result.has_invalidated_self() {
            unsafe { bindings::Gecko_NoteDirtyElement(element.0) };
        }
    }
}

#[no_mangle]
pub extern "C" fn Servo_HasPendingRestyleAncestor(
    element: &RawGeckoElement,
    may_need_to_flush_layout: bool,
) -> bool {
    let mut has_yet_to_be_styled = false;
    let mut element = Some(GeckoElement(element));
    while let Some(e) = element {
        if e.has_any_animation() {
            return true;
        }

        // If the element needs a frame, it means that we haven't styled it yet
        // after it got inserted in the document, and thus we may need to do
        // that for transitions and animations to trigger.
        //
        // This is a fast path in the common case, but `has_yet_to_be_styled` is
        // the real check for this.
        if e.needs_frame() {
            return true;
        }

        let data = e.borrow_data();
        if let Some(ref data) = data {
            if !data.hint.is_empty() {
                return true;
            }
            if has_yet_to_be_styled && !data.styles.is_display_none() {
                return true;
            }
            // Ideally, DOM mutations wouldn't affect layout trees of siblings.
            //
            // In practice, this can happen because Gecko deals pretty badly
            // with some kinds of content insertion and removals.
            //
            // If we may need to flush layout, we need frames to accurately
            // determine whether we'll actually flush, so if we have to
            // reconstruct we need to flush style, which is what will take care
            // of ensuring that frames are constructed, even if the style itself
            // is up-to-date.
            if may_need_to_flush_layout && data.damage.contains(GeckoRestyleDamage::reconstruct()) {
                return true;
            }
        }
        has_yet_to_be_styled = data.is_none();

        element = e.traversal_parent();
    }
    false
}

#[no_mangle]
pub unsafe extern "C" fn Servo_SelectorList_Parse(
    selector_list: &nsACString,
    is_chrome: bool,
) -> *mut SelectorList {
    use style::selector_parser::SelectorParser;

    let url_data = if is_chrome {
        dummy_chrome_url_data()
    } else {
        dummy_url_data()
    };

    let input = selector_list.as_str_unchecked();
    let selector_list = match SelectorParser::parse_author_origin_no_namespace(&input, url_data) {
        Ok(selector_list) => selector_list,
        Err(..) => return ptr::null_mut(),
    };

    Box::into_raw(Box::new(selector_list))
}

#[no_mangle]
pub unsafe extern "C" fn Servo_SelectorList_Drop(list: *mut SelectorList) {
    let _ = Box::from_raw(list);
}

#[no_mangle]
pub unsafe extern "C" fn Servo_IsValidCSSColor(value: &nsACString) -> bool {
    let mut input = ParserInput::new(value.as_str_unchecked());
    let mut input = Parser::new(&mut input);
    let context = ParserContext::new(
        Origin::Author,
        dummy_url_data(),
        Some(CssRuleType::Style),
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        /* namespaces = */ Default::default(),
        None,
        None,
    );
    specified::Color::is_valid(&context, &mut input)
}

#[no_mangle]
pub unsafe extern "C" fn Servo_ComputeColor(
    raw_data: Option<&PerDocumentStyleData>,
    current_color: structs::nscolor,
    value: &nsACString,
    result_color: &mut structs::nscolor,
    was_current_color: *mut bool,
    loader: *mut Loader,
) -> bool {
    let mut input = ParserInput::new(value.as_str_unchecked());
    let mut input = Parser::new(&mut input);
    let reporter = loader.as_mut().and_then(|loader| {
        // Make an ErrorReporter that will report errors as being "from DOM".
        ErrorReporter::new(ptr::null_mut(), loader, ptr::null_mut())
    });

    let context = ParserContext::new(
        Origin::Author,
        dummy_url_data(),
        Some(CssRuleType::Style),
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        /* namespaces = */ Default::default(),
        reporter.as_ref().map(|e| e as &dyn ParseErrorReporter),
        None,
    );

    let data;
    let device = match raw_data {
        Some(d) => {
            data = d.borrow();
            Some(data.stylist.device())
        },
        None => None,
    };

    let computed = match specified::Color::parse_and_compute(&context, &mut input, device) {
        Some(c) => c,
        None => return false,
    };

    let current_color = style::gecko::values::convert_nscolor_to_absolute_color(current_color);
    if !was_current_color.is_null() {
        *was_current_color = computed.is_currentcolor();
    }

    let rgba = computed.resolve_to_absolute(&current_color);
    *result_color = style::gecko::values::convert_absolute_color_to_nscolor(&rgba);
    true
}

#[no_mangle]
pub unsafe extern "C" fn Servo_ColorTo(
    from_color: &nsACString,
    to_color_space: &nsACString,
    result_color: &mut nsACString,
    result_components: &mut nsTArray<f32>,
    result_adjusted: &mut bool,
    loader: *mut Loader,
) -> bool {
    // Figure out the color space.
    let mut input = ParserInput::new(to_color_space.as_str_unchecked());
    let mut input = Parser::new(&mut input);
    let to_color_space = match ColorSpace::parse(&mut input) {
        Ok(color_space) => color_space,
        Err(_) => {
            // Can't parse the color space? Fail the conversion.
            return false;
        },
    };

    let mut input = ParserInput::new(from_color.as_str_unchecked());
    let mut input = Parser::new(&mut input);

    let reporter = loader.as_mut().and_then(|loader| {
        // Make an ErrorReporter that will report errors as being "from DOM".
        ErrorReporter::new(ptr::null_mut(), loader, ptr::null_mut())
    });

    let context = ParserContext::new(
        Origin::Author,
        dummy_url_data(),
        Some(CssRuleType::Style),
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        /* namespaces = */ Default::default(),
        reporter.as_ref().map(|e| e as &dyn ParseErrorReporter),
        None,
    );

    let specified = match specified::Color::parse(&context, &mut input) {
        Ok(color) => color,
        Err(_) => return false,
    };

    let color = match specified {
        specified::Color::Absolute(ref absolute) => &absolute.color,
        _ => {
            // Can't do anything with a non-absolute color from here, so we
            // fail the conversion.
            return false;
        },
    };

    let color = color.to_color_space(to_color_space);
    let mut s = String::new();
    color
        .write_author_preferred_value(&mut CssWriter::new(&mut s))
        .unwrap();
    result_color.assign(&s);

    result_components.extend(color.raw_components().iter().copied());

    // For now we don't do gamut mapping, so always false.
    *result_adjusted = false;

    true
}

#[no_mangle]
pub extern "C" fn Servo_ResolveColor(
    color: &computed::Color,
    foreground: &style::color::AbsoluteColor,
) -> style::color::AbsoluteColor {
    color.resolve_to_absolute(foreground)
}

#[no_mangle]
pub extern "C" fn Servo_ResolveCalcLengthPercentage(
    calc: &computed::length_percentage::CalcLengthPercentage,
    basis: f32,
) -> f32 {
    calc.resolve(computed::Length::new(basis)).px()
}

#[no_mangle]
pub extern "C" fn Servo_ConvertColorSpace(
    color: &AbsoluteColor,
    color_space: ColorSpace,
) -> AbsoluteColor {
    color.to_color_space(color_space)
}

#[no_mangle]
pub unsafe extern "C" fn Servo_IntersectionObserverRootMargin_Parse(
    value: &nsACString,
    result: *mut IntersectionObserverRootMargin,
) -> bool {
    let value = value.as_str_unchecked();
    let result = result.as_mut().unwrap();

    let mut input = ParserInput::new(&value);
    let mut parser = Parser::new(&mut input);

    let url_data = dummy_url_data();
    let context = ParserContext::new(
        Origin::Author,
        url_data,
        Some(CssRuleType::Style),
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        /* namespaces = */ Default::default(),
        None,
        None,
    );

    let margin = parser.parse_entirely(|p| IntersectionObserverRootMargin::parse(&context, p));
    match margin {
        Ok(margin) => {
            *result = margin;
            true
        },
        Err(..) => false,
    }
}

#[no_mangle]
pub extern "C" fn Servo_IntersectionObserverRootMargin_ToString(
    root_margin: &IntersectionObserverRootMargin,
    result: &mut nsACString,
) {
    let mut writer = CssWriter::new(result);
    root_margin.to_css(&mut writer).unwrap();
}

#[no_mangle]
pub extern "C" fn Servo_ParseTransformIntoMatrix(
    value: &nsACString,
    contain_3d: &mut bool,
    result: &mut structs::Matrix4x4Components,
) -> bool {
    use style::properties::longhands::transform;

    let string = unsafe { value.as_str_unchecked() };
    let mut input = ParserInput::new(&string);
    let mut parser = Parser::new(&mut input);
    let context = ParserContext::new(
        Origin::Author,
        unsafe { dummy_url_data() },
        Some(CssRuleType::Style),
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        /* namespaces = */ Default::default(),
        None,
        None,
    );

    let transform = match parser.parse_entirely(|t| transform::parse(&context, t)) {
        Ok(t) => t,
        Err(..) => return false,
    };

    let (m, is_3d) = match transform.to_transform_3d_matrix(None) {
        Ok(result) => result,
        Err(..) => return false,
    };

    *result = m.to_array();
    *contain_3d = is_3d;
    true
}

#[no_mangle]
pub extern "C" fn Servo_ParseFilters(
    value: &nsACString,
    ignore_urls: bool,
    data: *mut URLExtraData,
    out: &mut style::OwnedSlice<Filter>,
) -> bool {
    use style::values::specified::effects::SpecifiedFilter;

    let string = unsafe { value.as_str_unchecked() };
    let mut input = ParserInput::new(&string);
    let mut parser = Parser::new(&mut input);
    let url_data = unsafe { UrlExtraData::from_ptr_ref(&data) };
    let context = ParserContext::new(
        Origin::Author,
        url_data,
        None,
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        /* namespaces = */ Default::default(),
        None,
        None,
    );

    let mut filters = vec![];

    if parser
        .try_parse(|i| i.expect_ident_matching("none"))
        .is_ok()
    {
        return parser.expect_exhausted().is_ok();
    }

    if parser.is_exhausted() {
        return false;
    }

    while !parser.is_exhausted() {
        let specified_filter = match SpecifiedFilter::parse(&context, &mut parser) {
            Ok(f) => f,
            Err(..) => return false,
        };

        let filter = match specified_filter.to_computed_value_without_context() {
            Ok(f) => f,
            Err(..) => return false,
        };

        if ignore_urls && matches!(filter, Filter::Url(_)) {
            continue;
        }

        filters.push(filter);
    }

    *out = style::OwnedSlice::from(filters);
    true
}

#[no_mangle]
pub unsafe extern "C" fn Servo_ParseFontShorthandForMatching(
    value: &nsACString,
    data: *mut URLExtraData,
    family: &mut FontFamilyList,
    style: &mut FontStyle,
    stretch: &mut FontStretch,
    weight: &mut FontWeight,
    size: Option<&mut f32>,
    small_caps: Option<&mut bool>,
) -> bool {
    use style::properties::shorthands::font;
    use style::values::generics::font::FontStyle as GenericFontStyle;
    use style::values::specified::font as specified;

    let string = value.as_str_unchecked();
    let mut input = ParserInput::new(&string);
    let mut parser = Parser::new(&mut input);
    let url_data = UrlExtraData::from_ptr_ref(&data);
    let context = ParserContext::new(
        Origin::Author,
        url_data,
        Some(CssRuleType::FontFace),
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        /* namespaces = */ Default::default(),
        None,
        None,
    );

    let font = match parser.parse_entirely(|f| font::parse_value(&context, f)) {
        Ok(f) => f,
        Err(..) => return false,
    };

    // The system font is not acceptable, so we return false.
    match font.font_family {
        specified::FontFamily::Values(list) => *family = list,
        specified::FontFamily::System(_) => return false,
    }

    let specified_font_style = match font.font_style {
        specified::FontStyle::Specified(ref s) => s,
        specified::FontStyle::System(_) => return false,
    };

    *style = match *specified_font_style {
        GenericFontStyle::Normal => FontStyle::NORMAL,
        GenericFontStyle::Italic => FontStyle::ITALIC,
        GenericFontStyle::Oblique(ref angle) => FontStyle::oblique(angle.degrees()),
    };

    *stretch = match font.font_stretch {
        specified::FontStretch::Keyword(ref k) => k.compute(),
        specified::FontStretch::Stretch(ref p) => FontStretch::from_percentage(p.0.get()),
        specified::FontStretch::System(_) => return false,
    };

    *weight = match font.font_weight {
        specified::FontWeight::Absolute(w) => w.compute(),
        // Resolve relative font weights against the initial of font-weight
        // (normal, which is equivalent to 400).
        specified::FontWeight::Bolder => FontWeight::normal().bolder(),
        specified::FontWeight::Lighter => FontWeight::normal().lighter(),
        specified::FontWeight::System(_) => return false,
    };

    // XXX This is unfinished; see values::specified::FontSize::ToComputedValue
    // for a more complete implementation (but we can't use it as-is).
    if let Some(size) = size {
        *size = match font.font_size {
            specified::FontSize::Length(lp) => {
                use style::values::generics::transform::ToAbsoluteLength;
                match lp.to_pixel_length(None) {
                    Ok(len) => len,
                    Err(..) => return false,
                }
            },
            specified::FontSize::Keyword(info) => {
                let keyword = if info.kw != specified::FontSizeKeyword::Math {
                    info.kw
                } else {
                    specified::FontSizeKeyword::Medium
                };
                // Map absolute-size keywords to sizes.
                // TODO: Maybe get a meaningful quirks / base size from the caller?
                let quirks_mode = QuirksMode::NoQuirks;
                keyword
                    .to_length_without_context(
                        quirks_mode,
                        computed::Length::new(specified::FONT_MEDIUM_PX),
                    )
                    .0
                    .px()
            },
            // smaller, larger not currently supported
            specified::FontSize::Smaller |
            specified::FontSize::Larger |
            specified::FontSize::System(_) => {
                return false;
            },
        };
    }

    if let Some(small_caps) = small_caps {
        use style::computed_values::font_variant_caps::T::SmallCaps;
        *small_caps = font.font_variant_caps == SmallCaps;
    }

    true
}

#[no_mangle]
pub unsafe extern "C" fn Servo_SourceSizeList_Parse(value: &nsACString) -> *mut SourceSizeList {
    let value = value.as_str_unchecked();
    let mut input = ParserInput::new(value);
    let mut parser = Parser::new(&mut input);

    let context = ParserContext::new(
        Origin::Author,
        dummy_url_data(),
        Some(CssRuleType::Style),
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        /* namespaces = */ Default::default(),
        None,
        None,
    );

    // NB: Intentionally not calling parse_entirely.
    let list = SourceSizeList::parse(&context, &mut parser);
    Box::into_raw(Box::new(list))
}

#[no_mangle]
pub unsafe extern "C" fn Servo_SourceSizeList_Evaluate(
    raw_data: &PerDocumentStyleData,
    list: Option<&SourceSizeList>,
) -> i32 {
    let doc_data = raw_data.borrow();
    let device = doc_data.stylist.device();
    let quirks_mode = doc_data.stylist.quirks_mode();

    let result = match list {
        Some(list) => list.evaluate(device, quirks_mode),
        None => SourceSizeList::empty().evaluate(device, quirks_mode),
    };

    result.0
}

#[no_mangle]
pub unsafe extern "C" fn Servo_SourceSizeList_Drop(list: *mut SourceSizeList) {
    let _ = Box::from_raw(list);
}

#[no_mangle]
pub unsafe extern "C" fn Servo_InvalidateStyleForDocStateChanges(
    root: &RawGeckoElement,
    document_style: &PerDocumentStyleData,
    non_document_styles: &nsTArray<&AuthorStyles>,
    states_changed: u64,
) {
    use style::invalidation::element::document_state::DocumentStateInvalidationProcessor;
    use style::invalidation::element::invalidator::TreeStyleInvalidator;

    let document_data = document_style.borrow();

    let iter = document_data
        .stylist
        .iter_origins()
        .map(|(data, _origin)| data)
        .chain(
            non_document_styles
                .iter()
                .map(|author_styles| &*author_styles.data),
        );

    let mut selector_caches = SelectorCaches::default();
    let root = GeckoElement(root);
    let mut processor = DocumentStateInvalidationProcessor::new(
        iter,
        DocumentState::from_bits_retain(states_changed),
        &mut selector_caches,
        root.as_node().owner_doc().quirks_mode(),
    );

    let result =
        TreeStyleInvalidator::new(root, /* stack_limit_checker = */ None, &mut processor)
            .invalidate();

    debug_assert!(!result.has_invalidated_siblings(), "How in the world?");
    if result.has_invalidated_descendants() {
        bindings::Gecko_NoteDirtySubtreeForInvalidation(root.0);
    } else if result.has_invalidated_self() {
        bindings::Gecko_NoteDirtyElement(root.0);
    }
}

#[no_mangle]
pub unsafe extern "C" fn Servo_PseudoClass_GetStates(name: &nsACString) -> u64 {
    let name = name.as_str_unchecked();
    match NonTSPseudoClass::parse_non_functional(name) {
        None => 0,
        // Ignore :any-link since it contains both visited and unvisited state.
        Some(NonTSPseudoClass::AnyLink) => 0,
        Some(pseudo_class) => pseudo_class.state_flag().bits(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn Servo_UseCounters_Create() -> *mut UseCounters {
    Box::into_raw(Box::<UseCounters>::default())
}

#[no_mangle]
pub unsafe extern "C" fn Servo_UseCounters_Drop(c: *mut UseCounters) {
    let _ = Box::from_raw(c);
}

#[no_mangle]
pub unsafe extern "C" fn Servo_UseCounters_Merge(
    doc_counters: &UseCounters,
    sheet_counters: &UseCounters,
) {
    doc_counters.merge(sheet_counters)
}

#[no_mangle]
pub unsafe extern "C" fn Servo_IsPropertyIdRecordedInUseCounter(
    use_counters: &UseCounters,
    id: nsCSSPropertyID,
) -> bool {
    let id = NonCustomPropertyId::from_nscsspropertyid(id).unwrap();
    use_counters.non_custom_properties.recorded(id)
}

#[no_mangle]
pub unsafe extern "C" fn Servo_IsUnknownPropertyRecordedInUseCounter(
    use_counters: &UseCounters,
    p: CountedUnknownProperty,
) -> bool {
    use_counters.counted_unknown_properties.recorded(p)
}

#[no_mangle]
pub unsafe extern "C" fn Servo_IsCssPropertyRecordedInUseCounter(
    use_counters: &UseCounters,
    property: &nsACString,
    known_prop: *mut bool,
) -> bool {
    *known_prop = false;

    let prop_name = property.as_str_unchecked();
    if let Ok(p) = PropertyId::parse_unchecked_for_testing(prop_name) {
        if let Some(id) = p.non_custom_id() {
            *known_prop = true;
            return use_counters.non_custom_properties.recorded(id);
        }
    }

    if let Some(p) = CountedUnknownProperty::parse_for_testing(prop_name) {
        *known_prop = true;
        return use_counters.counted_unknown_properties.recorded(p);
    }

    false
}

#[no_mangle]
pub unsafe extern "C" fn Servo_SharedMemoryBuilder_Create(
    buffer: *mut u8,
    len: usize,
) -> *mut SharedMemoryBuilder {
    Box::into_raw(Box::new(SharedMemoryBuilder::new(buffer, len)))
}

#[no_mangle]
pub unsafe extern "C" fn Servo_SharedMemoryBuilder_AddStylesheet(
    builder: &mut SharedMemoryBuilder,
    contents: &StylesheetContents,
    error_message: &mut nsACString,
) -> *const LockedCssRules {
    // Assert some things we assume when we create a style sheet from shared
    // memory.
    debug_assert_eq!(contents.origin, Origin::UserAgent);
    debug_assert_eq!(contents.quirks_mode, QuirksMode::NoQuirks);
    debug_assert!(contents.source_map_url.read().is_none());
    debug_assert!(contents.source_url.read().is_none());

    match builder.write(&contents.rules) {
        Ok(rules_ptr) => &**rules_ptr,
        Err(message) => {
            error_message.assign(&message);
            ptr::null()
        },
    }
}

#[no_mangle]
pub unsafe extern "C" fn Servo_SharedMemoryBuilder_GetLength(
    builder: &SharedMemoryBuilder,
) -> usize {
    builder.len()
}

#[no_mangle]
pub unsafe extern "C" fn Servo_SharedMemoryBuilder_Drop(builder: *mut SharedMemoryBuilder) {
    let _ = Box::from_raw(builder);
}

#[no_mangle]
pub unsafe extern "C" fn Servo_StyleArcSlice_EmptyPtr() -> *mut c_void {
    style_traits::arc_slice::ArcSlice::<u64>::leaked_empty_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn Servo_LoadData_GetLazy(
    source: &url::LoadDataSource,
) -> *const url::LoadData {
    source.get()
}

#[no_mangle]
pub extern "C" fn Servo_LengthPercentage_ToCss(
    lp: &computed::LengthPercentage,
    result: &mut nsACString,
) {
    lp.to_css(&mut CssWriter::new(result)).unwrap();
}

#[no_mangle]
pub extern "C" fn Servo_FontStyle_ToCss(s: &FontStyle, result: &mut nsACString) {
    s.to_css(&mut CssWriter::new(result)).unwrap()
}

#[no_mangle]
pub extern "C" fn Servo_FontWeight_ToCss(w: &FontWeight, result: &mut nsACString) {
    w.to_css(&mut CssWriter::new(result)).unwrap()
}

#[no_mangle]
pub extern "C" fn Servo_FontStretch_ToCss(s: &FontStretch, result: &mut nsACString) {
    s.to_css(&mut CssWriter::new(result)).unwrap()
}

#[no_mangle]
pub extern "C" fn Servo_FontStretch_SerializeKeyword(
    s: &FontStretch,
    result: &mut nsACString,
) -> bool {
    let kw = match s.as_keyword() {
        Some(kw) => kw,
        None => return false,
    };
    kw.to_css(&mut CssWriter::new(result)).unwrap();
    true
}

#[no_mangle]
pub unsafe extern "C" fn Servo_CursorKind_Parse(
    cursor: &nsACString,
    result: &mut computed::ui::CursorKind,
) -> bool {
    match computed::ui::CursorKind::from_ident(cursor.as_str_unchecked()) {
        Ok(c) => {
            *result = c;
            true
        },
        Err(..) => false,
    }
}

#[no_mangle]
pub extern "C" fn Servo_FontFamily_Generic(generic: GenericFontFamily) -> &'static FontFamily {
    FontFamily::generic(generic)
}

#[no_mangle]
pub extern "C" fn Servo_FontFamily_ForSystemFont(name: &nsACString, out: &mut FontFamily) {
    *out = FontFamily::for_system_font(&name.to_utf8());
}

#[no_mangle]
pub extern "C" fn Servo_FontFamilyList_WithNames(
    names: &nsTArray<computed::font::SingleFontFamily>,
    out: &mut FontFamilyList,
) {
    *out = FontFamilyList {
        list: style_traits::arc_slice::ArcSlice::from_iter(names.iter().cloned()),
    };
}

#[no_mangle]
pub extern "C" fn Servo_FamilyName_Serialize(name: &FamilyName, result: &mut nsACString) {
    name.to_css(&mut CssWriter::new(result)).unwrap()
}

#[no_mangle]
pub extern "C" fn Servo_GenericFontFamily_Parse(input: &nsACString) -> GenericFontFamily {
    let context = ParserContext::new(
        Origin::Author,
        unsafe { dummy_url_data() },
        Some(CssRuleType::Style),
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        /* namespaces = */ Default::default(),
        None,
        None,
    );
    let value = input.to_utf8();
    let mut input = ParserInput::new(&value);
    let mut input = Parser::new(&mut input);
    GenericFontFamily::parse(&context, &mut input).unwrap_or(GenericFontFamily::None)
}

#[no_mangle]
pub extern "C" fn Servo_ColorScheme_Parse(input: &nsACString, out: &mut u8) -> bool {
    use style::values::specified::ColorScheme;

    let context = ParserContext::new(
        Origin::Author,
        unsafe { dummy_url_data() },
        Some(CssRuleType::Style),
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        /* namespaces = */ Default::default(),
        None,
        None,
    );
    let input = unsafe { input.as_str_unchecked() };
    let mut input = ParserInput::new(&input);
    let mut input = Parser::new(&mut input);
    let scheme = match input.parse_entirely(|i| ColorScheme::parse(&context, i)) {
        Ok(scheme) => scheme,
        Err(..) => return false,
    };
    *out = scheme.raw_bits();
    true
}

#[no_mangle]
pub extern "C" fn Servo_LayerBlockRule_GetName(rule: &LayerBlockRule, result: &mut nsACString) {
    if let Some(ref name) = rule.name {
        name.to_css(&mut CssWriter::new(result)).unwrap()
    }
}

#[no_mangle]
pub extern "C" fn Servo_ScopeRule_GetStart(rule: &ScopeRule, result: &mut nsACString) {
    if let Some(v) = rule.bounds.start.as_ref() {
        v.to_css(&mut CssWriter::new(result)).unwrap();
    } else {
        result.set_is_void(true);
    }
}

#[no_mangle]
pub extern "C" fn Servo_ScopeRule_GetEnd(rule: &ScopeRule, result: &mut nsACString) {
    if let Some(v) = rule.bounds.end.as_ref() {
        v.to_css(&mut CssWriter::new(result)).unwrap();
    } else {
        result.set_is_void(true);
    }
}

#[no_mangle]
pub extern "C" fn Servo_LayerStatementRule_GetNameCount(rule: &LayerStatementRule) -> usize {
    rule.names.len()
}

#[no_mangle]
pub extern "C" fn Servo_LayerStatementRule_GetNameAt(
    rule: &LayerStatementRule,
    index: usize,
    result: &mut nsACString,
) {
    if let Some(ref name) = rule.names.get(index) {
        name.to_css(&mut CssWriter::new(result)).unwrap()
    }
}

#[no_mangle]
pub unsafe extern "C" fn Servo_InvalidateForViewportUnits(
    document_style: &PerDocumentStyleData,
    root: &RawGeckoElement,
    dynamic_only: bool,
) {
    let mut document_data = document_style.borrow_mut();
    let ref mut stylist = document_data.stylist;
    let device = stylist.device();

    if !device.used_viewport_size() {
        return;
    }

    if dynamic_only && !device.used_dynamic_viewport_size() {
        return;
    }

    // If the viewport changed, then initial values containing viewport units need to be recomputed.
    if stylist
        .get_custom_property_initial_values_flags()
        .intersects(ComputedValueFlags::USES_VIEWPORT_UNITS)
    {
        stylist.rebuild_initial_values_for_custom_properties();
    }

    if style::invalidation::viewport_units::invalidate(GeckoElement(root)) {
        // The invalidation machinery propagates the bits up, but we still need
        // to tell the Gecko restyle root machinery about it.
        bindings::Gecko_NoteDirtySubtreeForInvalidation(root);
    }
}

#[no_mangle]
pub extern "C" fn Servo_InterpolateColor(
    interpolation: ColorInterpolationMethod,
    left: &AbsoluteColor,
    right: &AbsoluteColor,
    progress: f32,
) -> AbsoluteColor {
    style::color::mix::mix(
        interpolation,
        left,
        progress,
        right,
        1.0 - progress,
        ColorMixFlags::empty(),
    )
}

#[no_mangle]
pub extern "C" fn Servo_EasingFunctionAt(
    easing_function: &ComputedTimingFunction,
    progress: f64,
    before_flag: BeforeFlag,
) -> f64 {
    easing_function.calculate_output(progress, before_flag, 1e-7)
}

fn parse_no_context<'i, F, R>(string: &'i str, parse: F) -> Result<R, ()>
where
    F: FnOnce(&ParserContext, &mut Parser<'i, '_>) -> Result<R, ParseError<'i>>,
{
    let context = ParserContext::new(
        Origin::Author,
        unsafe { dummy_url_data() },
        None,
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        /* namespaces = */ Default::default(),
        None,
        None,
    );
    let mut input = ParserInput::new(string);
    Parser::new(&mut input)
        .parse_entirely(|i| parse(&context, i))
        .map_err(|_| ())
}

#[no_mangle]
// Parse a length without style context (for canvas2d letterSpacing/wordSpacing attributes).
// This accepts absolute lengths, and if a font-metrics-getter function is passed, also
// font-relative ones, but not other units (such as percentages, viewport-relative, etc)
// that would require a full style context to resolve.
pub extern "C" fn Servo_ParseLengthWithoutStyleContext(
    len: &nsACString,
    out: &mut f32,
    get_font_metrics: Option<unsafe extern "C" fn(*mut c_void) -> GeckoFontMetrics>,
    getter_context: *mut c_void,
) -> bool {
    let metrics_getter = if let Some(getter) = get_font_metrics {
        Some(move || -> GeckoFontMetrics { unsafe { getter(getter_context) } })
    } else {
        None
    };
    let value = parse_no_context(unsafe { len.as_str_unchecked() }, specified::Length::parse)
        .and_then(|p| p.to_computed_pixel_length_with_font_metrics(metrics_getter));
    match value {
        Ok(v) => {
            *out = v;
            true
        },
        Err(..) => false,
    }
}

#[no_mangle]
pub extern "C" fn Servo_SlowRgbToColorName(r: u8, g: u8, b: u8, result: &mut nsACString) -> bool {
    let mut candidates = SmallVec::<[&'static str; 5]>::new();
    for (name, color) in cssparser::color::all_named_colors() {
        if color == (r, g, b) {
            candidates.push(name);
        }
    }
    if candidates.is_empty() {
        return false;
    }
    // DevTools expect the first alphabetically.
    candidates.sort();
    result.assign(candidates[0]);
    true
}

#[no_mangle]
pub extern "C" fn Servo_ColorNameToRgb(name: &nsACString, out: &mut structs::nscolor) -> bool {
    match cssparser::color::parse_named_color(unsafe { name.as_str_unchecked() }) {
        Ok((r, g, b)) => {
            *out = style::gecko::values::convert_absolute_color_to_nscolor(&AbsoluteColor::new(
                ColorSpace::Srgb,
                r,
                g,
                b,
                1.0,
            ));
            true
        },
        _ => false,
    }
}

#[repr(u8)]
pub enum RegisterCustomPropertyResult {
    SuccessfullyRegistered,
    InvalidName,
    AlreadyRegistered,
    InvalidSyntax,
    NoInitialValue,
    InvalidInitialValue,
    InitialValueNotComputationallyIndependent,
}

/// https://drafts.css-houdini.org/css-properties-values-api-1/#the-registerproperty-function
#[no_mangle]
pub extern "C" fn Servo_RegisterCustomProperty(
    per_doc_data: &PerDocumentStyleData,
    extra_data: *mut URLExtraData,
    name: &nsACString,
    syntax: &nsACString,
    inherits: bool,
    initial_value: Option<&nsACString>,
) -> RegisterCustomPropertyResult {
    use self::RegisterCustomPropertyResult::*;
    use style::custom_properties::SpecifiedValue;
    use style::properties_and_values::rule::{PropertyRegistrationError, PropertyRuleName};
    use style::properties_and_values::syntax::Descriptor;

    let mut per_doc_data = per_doc_data.borrow_mut();
    let url_data = unsafe { UrlExtraData::from_ptr_ref(&extra_data) };
    let name = unsafe { name.as_str_unchecked() };
    let syntax = unsafe { syntax.as_str_unchecked() };
    let initial_value = initial_value.map(|v| unsafe { v.as_str_unchecked() });

    // If name is not a custom property name string, throw a SyntaxError and exit this algorithm.
    let name = match style::custom_properties::parse_name(name) {
        Ok(n) => Atom::from(n),
        Err(()) => return InvalidName,
    };

    // If property set already contains an entry with name as its property name (compared
    // codepoint-wise), throw an InvalidModificationError and exit this algorithm.
    if per_doc_data
        .stylist
        .custom_property_script_registry()
        .get(&name)
        .is_some()
    {
        return AlreadyRegistered;
    }
    // Attempt to consume a syntax definition from syntax. If it returns failure, throw a
    // SyntaxError. Otherwise, let syntax definition be the returned syntax definition.
    let Ok(syntax) = Descriptor::from_str(syntax, /* preserve_specified = */ false) else {
        return InvalidSyntax;
    };

    let initial_value = match initial_value {
        Some(v) => {
            let mut input = ParserInput::new(v);
            let parsed = Parser::new(&mut input)
                .parse_entirely(|input| {
                    input.skip_whitespace();
                    SpecifiedValue::parse(input, url_data).map(Arc::new)
                })
                .ok();
            if parsed.is_none() {
                return InvalidInitialValue;
            }
            parsed
        },
        None => None,
    };

    if let Err(error) =
        PropertyRegistration::validate_initial_value(&syntax, initial_value.as_deref())
    {
        return match error {
            PropertyRegistrationError::InitialValueNotComputationallyIndependent => {
                InitialValueNotComputationallyIndependent
            },
            PropertyRegistrationError::InvalidInitialValue => InvalidInitialValue,
            PropertyRegistrationError::NoInitialValue => NoInitialValue,
        };
    }

    per_doc_data
        .stylist
        .custom_property_script_registry_mut()
        .register(PropertyRegistration {
            name: PropertyRuleName(name),
            data: PropertyRegistrationData {
                syntax,
                inherits: if inherits {
                    PropertyInherits::True
                } else {
                    PropertyInherits::False
                },
                initial_value,
            },
            url_data: url_data.clone(),
            source_location: SourceLocation { line: 0, column: 0 },
        });

    per_doc_data
        .stylist
        .rebuild_initial_values_for_custom_properties();

    SuccessfullyRegistered
}

#[repr(C)]
pub struct PropDef {
    // The name of the property.
    pub name: Atom,
    // The syntax of the property.
    pub syntax: nsCString,
    // Whether the property inherits.
    pub inherits: bool,
    pub has_initial_value: bool,
    pub initial_value: nsCString,
    // True if the property was set with CSS.registerProperty
    pub from_js: bool,
}

impl PropDef {
    /// Creates a PropDef from a name and a PropertyRegistration.
    pub fn new(name: Atom, property_registration: &PropertyRegistration, from_js: bool) -> Self {
        let mut syntax = nsCString::new();
        if let Some(spec) = property_registration.data.syntax.specified_string() {
            syntax.assign(spec);
        } else {
            // FIXME: Descriptor::to_css should behave consistently (probably this shouldn't use
            // the ToCss trait).
            property_registration
                .data
                .syntax
                .to_css(&mut CssWriter::new(&mut syntax))
                .unwrap();
        };
        let initial_value = property_registration.data.initial_value.to_css_nscstring();
        PropDef {
            name,
            syntax,
            inherits: property_registration.data.inherits(),
            has_initial_value: property_registration.data.initial_value.is_some(),
            initial_value,
            from_js,
        }
    }
}

#[no_mangle]
pub extern "C" fn Servo_GetRegisteredCustomProperties(
    per_doc_data: &PerDocumentStyleData,
    custom_properties: &mut nsTArray<PropDef>,
) {
    let stylist = &per_doc_data.borrow().stylist;

    custom_properties.extend(
        stylist
            .custom_property_script_registry()
            .get_all()
            .iter()
            .map(|(name, property_registration)| {
                PropDef::new(name.clone(), property_registration, /* from_js */ true)
            }),
    );

    for (cascade_data, _origin) in stylist.iter_origins() {
        custom_properties.extend(cascade_data.custom_property_registrations().iter().map(
            |(name, value)| {
                let property_registration = &value.last().unwrap().0;
                PropDef::new(
                    name.clone(),
                    property_registration,
                    /* from_js */
                    false,
                )
            },
        ))
    }
}


#[no_mangle]
pub unsafe extern "C" fn Servo_Value_Matches_Syntax(
    value: &nsACString,
    syntax: &nsACString,
    extra_data: *mut URLExtraData,
) -> bool {
    use style::properties_and_values::syntax::Descriptor;
    use style::properties_and_values::value::{
        AllowComputationallyDependent,
        SpecifiedValue,
    };

    // Attempt to consume a syntax definition from syntax.
    let syntax = unsafe { syntax.as_str_unchecked() };
    let Ok(syntax) = Descriptor::from_str(syntax, /* preserve_specified = */ false) else {
        return false;
    };

    let css_text = unsafe { value.as_str_unchecked() };
    let mut input = ParserInput::new(css_text);
    let mut input = Parser::new(&mut input);
    input.skip_whitespace();
    let url_data = unsafe { UrlExtraData::from_ptr_ref(&extra_data) };

    SpecifiedValue::parse(
        &mut input,
        &syntax,
        url_data,
        AllowComputationallyDependent::Yes,
    ).is_ok()
}


#[repr(C)]
pub struct SelectorWarningData {
    /// Index to the selector generating the warning.
    pub index: usize,
    /// Kind of the warning.
    pub kind: SelectorWarningKind,
}

#[no_mangle]
pub extern "C" fn Servo_GetSelectorWarnings(
    rule: &LockedStyleRule,
    warnings: &mut nsTArray<SelectorWarningData>,
) {
    read_locked_arc(rule, |r| {
        for (i, selector) in r.selectors.slice().iter().enumerate() {
            for k in SelectorWarningKind::from_selector(selector) {
                warnings.push(SelectorWarningData { index: i, kind: k });
            }
        }
    });
}

#[no_mangle]
pub extern "C" fn Servo_GetRuleBodyText(initial_text: &nsACString, ret_val: &mut nsACString) {
    let css_text = unsafe { initial_text.as_str_unchecked() };
    let mut input = ParserInput::new(&css_text);
    let mut input = Parser::new(&mut input);

    let mut found_start = false;

    // Search forward for the opening brace.
    while let Ok(token) = input.next() {
        match *token {
            Token::CurlyBracketBlock => {
                found_start = true;
                break;
            },
            _ => {},
        }

        if token.is_parse_error() {
            break;
        }
    }

    if !found_start {
        ret_val.set_is_void(true);
        return;
    }

    let token_start = input.position();
    // Parse the nested block to move the parser to the end of the block
    let _ =
        input.parse_nested_block(|_i| -> Result<(), CssParseError<'_, BasicParseError>> { Ok(()) });

    // We're not guaranteed to have a closing bracket, but when we do, we need to move
    // the end offset before it.
    let mut token_slice = input.slice_from(token_start);
    if token_slice.ends_with("}") {
        token_slice = token_slice.strip_suffix("}").unwrap();
    }
    ret_val.assign(token_slice);
}

#[no_mangle]
pub extern "C" fn Servo_ReplaceBlockRuleBodyTextInStylesheetText(
    stylesheet_text: &nsACString,
    line: u32,
    column: u32,
    new_body_text: &nsACString,
    ret_val: &mut nsACString,
) {
    let css_text = unsafe { stylesheet_text.as_str_unchecked() };

    let Some(rule_start_index) = get_byte_index_from_line_and_column(css_text, line, column) else {
        ret_val.set_is_void(true);
        return;
    };

    let mut input = ParserInput::new(&css_text[rule_start_index..]);
    let mut input = Parser::new(&mut input);
    let mut found_start = false;

    // Search forward for the opening brace.
    while let Ok(token) = input.next() {
        if matches!(*token, Token::CurlyBracketBlock) {
            found_start = true;
            break;
        }

        if token.is_parse_error() {
            break;
        }
    }

    if !found_start {
        ret_val.set_is_void(true);
        return;
    }

    let token_start = input.position();
    let rule_body_start = rule_start_index + token_start.byte_index();
    // Parse the nested block to move the parser to the end of the block
    let _ =
        input.parse_nested_block(|_i| -> Result<(), CssParseError<'_, BasicParseError>> { Ok(()) });
    let mut rule_body_end = rule_start_index + input.position().byte_index();

    // We're not guaranteed to have a closing bracket, but when we do, we need to move
    // the end offset before it.
    let token_slice = input.slice_from(token_start);
    if token_slice.ends_with("}") {
        rule_body_end -= 1;
    }

    ret_val.append(&css_text[..rule_body_start]);
    ret_val.append(new_body_text);
    ret_val.append(&css_text[rule_body_end..]);
}

/// Find css_text byte position corresponding to the passed line and column
fn get_byte_index_from_line_and_column(css_text: &str, line: u32, column: u32) -> Option<usize> {
    // Find the byte index of the start of the passed line within css_text
    let mut line_byte_index = Some(0);
    if line != 1 {
        let mut current_line = 1;
        let mut last_byte = None;
        let mut bytes_iter = css_text.bytes();
        line_byte_index = bytes_iter.position(|byte| {
            // We want to get the position _after_ the EOF sequence
            let on_expected_line = current_line == line;
            let is_previous_byte_carriage_return = last_byte == Some(b'\r');
            last_byte = Some(byte);

            if byte == b'\r' {
                current_line += 1;
            } else if byte == b'\n' {
                if !is_previous_byte_carriage_return {
                    current_line += 1;
                } else {
                    return false;
                }
            }
            on_expected_line
        });
    }

    if line_byte_index.is_none() {
        return None;
    }

    if column == 1 {
        return line_byte_index;
    }

    let line_byte_index = line_byte_index.unwrap();
    let mut current_column = 1;
    for (byte_index, _char) in css_text[line_byte_index..].char_indices() {
        if current_column == column {
            return Some(line_byte_index + byte_index);
        }
        current_column += 1;
    }

    None
}

#[repr(C)]
pub struct CSSToken {
    pub text: nsCString,
    pub token_type: nsCString,
    pub has_unit: bool,
    pub unit: nsCString,
    pub has_number: bool,
    pub number: f32,
    pub has_value: bool,
    pub value: nsCString,
    // line and column at which the token starts
    pub line: u32,
    pub column: u32,
}

#[no_mangle]
pub unsafe extern "C" fn Servo_CSSParser_create(text: &nsACString) -> *mut ParserState {
    let css_text = unsafe { text.as_str_unchecked() };
    let mut parser_input = ParserInput::new(&css_text);
    let input = Parser::new(&mut parser_input);
    Box::into_raw(Box::new(input.state()))
}

#[no_mangle]
pub unsafe extern "C" fn Servo_CSSParser_destroy(state: *mut ParserState) {
    drop(Box::from_raw(state));
}

#[no_mangle]
pub unsafe extern "C" fn Servo_CSSParser_GetCurrentLine(state: &ParserState) -> u32 {
    return state.source_location().line;
}

#[no_mangle]
pub unsafe extern "C" fn Servo_CSSParser_GetCurrentColumn(state: &ParserState) -> u32 {
    return state.source_location().column;
}

#[no_mangle]
pub unsafe extern "C" fn Servo_CSSParser_NextToken(
    text: &nsACString,
    state: &mut ParserState,
    css_token: &mut CSSToken,
) -> bool {
    let css_text = unsafe { text.as_str_unchecked() };
    let mut parser_input = ParserInput::new(&css_text);
    let mut input = Parser::new(&mut parser_input);
    input.reset(state);

    let token_start = input.position();
    let location_start = state.source_location();
    let Ok(token) = &input.next_including_whitespace_and_comments() else {
        return false;
    };

    let token_type = match *token {
        Token::Ident(_) => "Ident",
        Token::AtKeyword(_) => "AtKeyword",
        Token::Hash(_) => "Hash",
        Token::IDHash(_) => "IDHash",
        Token::QuotedString(_) => "QuotedString",
        Token::UnquotedUrl(_) => "UnquotedUrl",
        Token::Delim(_) => "Delim",
        Token::Number { .. } => "Number",
        Token::Percentage { .. } => "Percentage",
        Token::Dimension { .. } => "Dimension",
        Token::WhiteSpace(_) => "WhiteSpace",
        Token::Comment(_) => "Comment",
        Token::Colon => "Colon",
        Token::Semicolon => "Semicolon",
        Token::Comma => "Comma",
        Token::IncludeMatch => "IncludeMatch",
        Token::DashMatch => "DashMatch",
        Token::PrefixMatch => "PrefixMatch",
        Token::SuffixMatch => "SuffixMatch",
        Token::SubstringMatch => "SubstringMatch",
        Token::CDO => "CDO",
        Token::CDC => "CDC",
        Token::Function(_) => "Function",
        Token::ParenthesisBlock => "ParenthesisBlock",
        Token::SquareBracketBlock => "SquareBracketBlock",
        Token::CurlyBracketBlock => "CurlyBracketBlock",
        Token::BadUrl(_) => "BadUrl",
        Token::BadString(_) => "BadString",
        Token::CloseParenthesis => "CloseParenthesis",
        Token::CloseSquareBracket => "CloseSquareBracket",
        Token::CloseCurlyBracket => "CloseCurlyBracket",
    };

    let token_value = match *token {
        Token::Ident(value) |
        Token::AtKeyword(value) |
        Token::Hash(value) |
        Token::IDHash(value) |
        Token::QuotedString(value) |
        Token::UnquotedUrl(value) |
        Token::Function(value) |
        Token::BadUrl(value) |
        Token::BadString(value) => {
            let mut text = nsCString::new();
            text.assign(value.as_bytes());
            Some(text)
        },
        // value is a str here, we need a different branch to handle it
        Token::Comment(value) => {
            let mut text = nsCString::new();
            text.assign(value.as_bytes());
            Some(text)
        },
        // Delim and WhiteSpace also have value, but they will be similar to text, so don't
        // include them
        Token::Delim(_) |
        Token::WhiteSpace(_) |
        // Number, Percentage and Dimension expose numeric values that will be exposed in `number`
        Token::Number{..}  |
        Token::Percentage{..}  |
        Token::Dimension{..}  |
        // The rest of the tokens don't expose a string value
        Token::Colon |
        Token::Semicolon |
        Token::Comma |
        Token::IncludeMatch |
        Token::DashMatch |
        Token::PrefixMatch |
        Token::SuffixMatch |
        Token::SubstringMatch |
        Token::CDO |
        Token::CDC |
        Token::ParenthesisBlock |
        Token::SquareBracketBlock |
        Token::CurlyBracketBlock |
        Token::CloseParenthesis |
        Token::CloseSquareBracket |
        Token::CloseCurlyBracket => None
    };

    let token_unit = match *token {
        Token::Dimension { ref unit, .. } => {
            let mut unit_text = nsCString::new();
            unit_text.assign(unit.as_bytes());
            Some(unit_text)
        },
        _ => None,
    };

    let token_number = match *token {
        Token::Dimension { ref value, .. } => Some(value),
        Token::Number { ref value, .. } => Some(value),
        Token::Percentage { ref unit_value, .. } => Some(unit_value),
        _ => None,
    };
    css_token.has_number = token_number.is_some();
    if css_token.has_number {
        css_token.number = *token_number.unwrap();
    }

    let need_to_parse_nested_block = match *token {
        Token::Function(_) |
        Token::ParenthesisBlock |
        Token::CurlyBracketBlock |
        Token::SquareBracketBlock => true,
        _ => false,
    };

    let mut text = nsCString::new();
    text.assign(&input.slice_from(token_start));

    css_token.text = text;
    css_token.token_type = token_type.into();
    css_token.has_value = token_value.is_some();
    if css_token.has_value {
        css_token.value = token_value.unwrap();
    }
    css_token.has_unit = token_unit.is_some();
    if css_token.has_unit {
        css_token.unit = token_unit.unwrap();
    }

    css_token.line = location_start.line;
    css_token.column = location_start.column;

    if need_to_parse_nested_block {
        let _ = input.parse_nested_block(|i| -> Result<(), CssParseError<'_, BasicParseError>> {
            *state = i.state();
            Ok(())
        });
    } else {
        *state = input.state();
    }

    return true;
}
