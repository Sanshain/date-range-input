'use strict';

function noop() { }
function run(fn) {
    return fn();
}
function blank_object() {
    return Object.create(null);
}
function run_all(fns) {
    fns.forEach(run);
}
function is_function(thing) {
    return typeof thing === 'function';
}
function safe_not_equal(a, b) {
    return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}
function is_empty(obj) {
    return Object.keys(obj).length === 0;
}
function append(target, node) {
    target.appendChild(node);
}
function append_styles(target, style_sheet_id, styles) {
    const append_styles_to = get_root_for_style(target);
    if (!append_styles_to.getElementById(style_sheet_id)) {
        const style = element('style');
        style.id = style_sheet_id;
        style.textContent = styles;
        append_stylesheet(append_styles_to, style);
    }
}
function get_root_for_style(node) {
    if (!node)
        return document;
    const root = node.getRootNode ? node.getRootNode() : node.ownerDocument;
    if (root && root.host) {
        return root;
    }
    return node.ownerDocument;
}
function append_stylesheet(node, style) {
    append(node.head || node, style);
    return style.sheet;
}
function insert(target, node, anchor) {
    target.insertBefore(node, anchor || null);
}
function detach(node) {
    node.parentNode.removeChild(node);
}
function destroy_each(iterations, detaching) {
    for (let i = 0; i < iterations.length; i += 1) {
        if (iterations[i])
            iterations[i].d(detaching);
    }
}
function element(name) {
    return document.createElement(name);
}
function text(data) {
    return document.createTextNode(data);
}
function space() {
    return text(' ');
}
function empty() {
    return text('');
}
function listen(node, event, handler, options) {
    node.addEventListener(event, handler, options);
    return () => node.removeEventListener(event, handler, options);
}
function attr(node, attribute, value) {
    if (value == null)
        node.removeAttribute(attribute);
    else if (node.getAttribute(attribute) !== value)
        node.setAttribute(attribute, value);
}
function children(element) {
    return Array.from(element.childNodes);
}
function set_data(text, data) {
    data = '' + data;
    if (text.wholeText !== data)
        text.data = data;
}
function set_style(node, key, value, important) {
    if (value === null) {
        node.style.removeProperty(key);
    }
    else {
        node.style.setProperty(key, value, important ? 'important' : '');
    }
}
function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
    const e = document.createEvent('CustomEvent');
    e.initCustomEvent(type, bubbles, cancelable, detail);
    return e;
}

let current_component;
function set_current_component(component) {
    current_component = component;
}
function get_current_component() {
    if (!current_component)
        throw new Error('Function called outside component initialization');
    return current_component;
}
/**
 * Creates an event dispatcher that can be used to dispatch [component events](/docs#template-syntax-component-directives-on-eventname).
 * Event dispatchers are functions that can take two arguments: `name` and `detail`.
 *
 * Component events created with `createEventDispatcher` create a
 * [CustomEvent](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent).
 * These events do not [bubble](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Building_blocks/Events#Event_bubbling_and_capture).
 * The `detail` argument corresponds to the [CustomEvent.detail](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent/detail)
 * property and can contain any type of data.
 *
 * https://svelte.dev/docs#run-time-svelte-createeventdispatcher
 */
function createEventDispatcher() {
    const component = get_current_component();
    return (type, detail, { cancelable = false } = {}) => {
        const callbacks = component.$$.callbacks[type];
        if (callbacks) {
            // TODO are there situations where events could be dispatched
            // in a server (non-DOM) environment?
            const event = custom_event(type, detail, { cancelable });
            callbacks.slice().forEach(fn => {
                fn.call(component, event);
            });
            return !event.defaultPrevented;
        }
        return true;
    };
}

const dirty_components = [];
const binding_callbacks = [];
const render_callbacks = [];
const flush_callbacks = [];
const resolved_promise = Promise.resolve();
let update_scheduled = false;
function schedule_update() {
    if (!update_scheduled) {
        update_scheduled = true;
        resolved_promise.then(flush);
    }
}
function add_render_callback(fn) {
    render_callbacks.push(fn);
}
function add_flush_callback(fn) {
    flush_callbacks.push(fn);
}
// flush() calls callbacks in this order:
// 1. All beforeUpdate callbacks, in order: parents before children
// 2. All bind:this callbacks, in reverse order: children before parents.
// 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
//    for afterUpdates called during the initial onMount, which are called in
//    reverse order: children before parents.
// Since callbacks might update component values, which could trigger another
// call to flush(), the following steps guard against this:
// 1. During beforeUpdate, any updated components will be added to the
//    dirty_components array and will cause a reentrant call to flush(). Because
//    the flush index is kept outside the function, the reentrant call will pick
//    up where the earlier call left off and go through all dirty components. The
//    current_component value is saved and restored so that the reentrant call will
//    not interfere with the "parent" flush() call.
// 2. bind:this callbacks cannot trigger new flush() calls.
// 3. During afterUpdate, any updated components will NOT have their afterUpdate
//    callback called a second time; the seen_callbacks set, outside the flush()
//    function, guarantees this behavior.
const seen_callbacks = new Set();
let flushidx = 0; // Do *not* move this inside the flush() function
function flush() {
    const saved_component = current_component;
    do {
        // first, call beforeUpdate functions
        // and update components
        while (flushidx < dirty_components.length) {
            const component = dirty_components[flushidx];
            flushidx++;
            set_current_component(component);
            update(component.$$);
        }
        set_current_component(null);
        dirty_components.length = 0;
        flushidx = 0;
        while (binding_callbacks.length)
            binding_callbacks.pop()();
        // then, once components are updated, call
        // afterUpdate functions. This may cause
        // subsequent updates...
        for (let i = 0; i < render_callbacks.length; i += 1) {
            const callback = render_callbacks[i];
            if (!seen_callbacks.has(callback)) {
                // ...so guard against infinite loops
                seen_callbacks.add(callback);
                callback();
            }
        }
        render_callbacks.length = 0;
    } while (dirty_components.length);
    while (flush_callbacks.length) {
        flush_callbacks.pop()();
    }
    update_scheduled = false;
    seen_callbacks.clear();
    set_current_component(saved_component);
}
function update($$) {
    if ($$.fragment !== null) {
        $$.update();
        run_all($$.before_update);
        const dirty = $$.dirty;
        $$.dirty = [-1];
        $$.fragment && $$.fragment.p($$.ctx, dirty);
        $$.after_update.forEach(add_render_callback);
    }
}
const outroing = new Set();
let outros;
function transition_in(block, local) {
    if (block && block.i) {
        outroing.delete(block);
        block.i(local);
    }
}
function transition_out(block, local, detach, callback) {
    if (block && block.o) {
        if (outroing.has(block))
            return;
        outroing.add(block);
        outros.c.push(() => {
            outroing.delete(block);
            if (callback) {
                if (detach)
                    block.d(1);
                callback();
            }
        });
        block.o(local);
    }
    else if (callback) {
        callback();
    }
}

function bind(component, name, callback) {
    const index = component.$$.props[name];
    if (index !== undefined) {
        component.$$.bound[index] = callback;
        callback(component.$$.ctx[index]);
    }
}
function create_component(block) {
    block && block.c();
}
function mount_component(component, target, anchor, customElement) {
    const { fragment, after_update } = component.$$;
    fragment && fragment.m(target, anchor);
    if (!customElement) {
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
            // if the component was destroyed immediately
            // it will update the `$$.on_destroy` reference to `null`.
            // the destructured on_destroy may still reference to the old array
            if (component.$$.on_destroy) {
                component.$$.on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
    }
    after_update.forEach(add_render_callback);
}
function destroy_component(component, detaching) {
    const $$ = component.$$;
    if ($$.fragment !== null) {
        run_all($$.on_destroy);
        $$.fragment && $$.fragment.d(detaching);
        // TODO null out other refs, including component.$$ (but need to
        // preserve final state?)
        $$.on_destroy = $$.fragment = null;
        $$.ctx = [];
    }
}
function make_dirty(component, i) {
    if (component.$$.dirty[0] === -1) {
        dirty_components.push(component);
        schedule_update();
        component.$$.dirty.fill(0);
    }
    component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
}
function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
    const parent_component = current_component;
    set_current_component(component);
    const $$ = component.$$ = {
        fragment: null,
        ctx: [],
        // state
        props,
        update: noop,
        not_equal,
        bound: blank_object(),
        // lifecycle
        on_mount: [],
        on_destroy: [],
        on_disconnect: [],
        before_update: [],
        after_update: [],
        context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
        // everything else
        callbacks: blank_object(),
        dirty,
        skip_bound: false,
        root: options.target || parent_component.$$.root
    };
    append_styles && append_styles($$.root);
    let ready = false;
    $$.ctx = instance
        ? instance(component, options.props || {}, (i, ret, ...rest) => {
            const value = rest.length ? rest[0] : ret;
            if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                if (!$$.skip_bound && $$.bound[i])
                    $$.bound[i](value);
                if (ready)
                    make_dirty(component, i);
            }
            return ret;
        })
        : [];
    $$.update();
    ready = true;
    run_all($$.before_update);
    // `false` as a special case of no DOM component
    $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
    if (options.target) {
        if (options.hydrate) {
            const nodes = children(options.target);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.l(nodes);
            nodes.forEach(detach);
        }
        else {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.c();
        }
        if (options.intro)
            transition_in(component.$$.fragment);
        mount_component(component, options.target, options.anchor, options.customElement);
        flush();
    }
    set_current_component(parent_component);
}
/**
 * Base class for Svelte components. Used when dev=false.
 */
class SvelteComponent {
    $destroy() {
        destroy_component(this, 1);
        this.$destroy = noop;
    }
    $on(type, callback) {
        if (!is_function(callback)) {
            return noop;
        }
        const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
        callbacks.push(callback);
        return () => {
            const index = callbacks.indexOf(callback);
            if (index !== -1)
                callbacks.splice(index, 1);
        };
    }
    $set($$props) {
        if (this.$$set && !is_empty($$props)) {
            this.$$.skip_bound = true;
            this.$$set($$props);
            this.$$.skip_bound = false;
        }
    }
}

let monthNames = null;
const getMonthNames = () => {
	if (!monthNames) {
		const formatter = new Intl.DateTimeFormat(undefined, {
			month: `long`,
		});

		const zeroThroughEleven = new Array(12).fill(null).map((_, i) => i);

		monthNames = zeroThroughEleven.map(jsDateMonthNumber => formatter.format(new Date(2020, jsDateMonthNumber)));
	}

	return monthNames
};

var getMonthName = monthNumber => {
	if (monthNumber < 1 || monthNumber > 12) {
		throw new Error(`getMonthName argument must be between 1 and 12 – you passed in ${monthNumber}`)
	}

	return getMonthNames()[monthNumber - 1]
};

const anArbitrarySundayEarlyInTheMonth = new Date(2020, 0, 5);
const dayNumbers = [ 0, 1, 2, 3, 4, 5, 6 ];

let daysOfWeek = null;

var getDaysOfTheWeek = () => {
	if (!daysOfWeek) {
		const formatter = new Intl.DateTimeFormat(undefined, {
			weekday: `short`,
		});

		daysOfWeek = dayNumbers.map(dayNumber => {
			const date = new Date(anArbitrarySundayEarlyInTheMonth);
			date.setDate(date.getDate() + dayNumber);
			return formatter.format(date)
		});
	}

	return daysOfWeek
};

function calendarize (target, offset) {
	var i=0, j=0, week, out=[], date = new Date(target || new Date);
	var year = date.getFullYear(), month = date.getMonth();

	// day index (of week) for 1st of month
	var first = new Date(year, month, 1 - (offset | 0)).getDay();

	// how many days there are in this month
	var days = new Date(year, month+1, 0).getDate();

	while (i < days) {
		for (j=0, week=Array(7); j < 7;) {
			while (j < first) week[j++] = 0;
			week[j++] = ++i > days ? 0 : i;
			first = 0;
		}
		out.push(week);
	}

	return out;
}

const datesMatch = (a, b) => a.year === b.year
	&& a.month === b.month
	&& a.day === b.day;

const dateGt = (a, b) => {
	if (a.year === b.year && a.month === b.month) {
		return a.day > b.day
	} else if (a.year === b.year) {
		return a.month > b.month
	} else {
		return a.year > b.year
	}
};

const dateGte = (a, b) => dateGt(a, b) || datesMatch(a, b);

const dateLt = (a, b) => !dateGte(a, b);

const dateLte = (a, b) => dateLt(a, b) || datesMatch(a, b);

function eventIsModifiedByKeyPress(event) {
	return !!(event.metaKey || event.altKey || event.ctrlKey || event.shiftKey)
}
function isLeftClick(event){
	return event.button === 0
}

var clickShouldBeInterceptedForNavigation = function shouldIntercept(event) {
	return !event.defaultPrevented
		&& !eventIsModifiedByKeyPress(event)
		&& isLeftClick(event)
};

/* src\Month.svelte generated by Svelte v3.51.0 */

function add_css(target) {
	append_styles(target, "svelte-1c4kgvu", ":root,:host{--size-unit:4px;--size-quarter:var(--size-unit);--size-half:calc(var(--size-unit) * 2);--size-base:calc(var(--size-unit) * 4);--size-double:calc(var(--size-unit) * 8);--border-width:1px;--border-radius:var(--size-quarter);--size-default-spacing:var(--size-half);--control-height:calc(var(--size-unit) * 9)}:root,:host{--text-font-size-small:calc(var(--size-base) * .75);--text-font-size-base:var(--size-base);--text-font-family:Roboto, sans-serif;--text-font-weight-base:400;--text-font-weight-bold:700}:root,:host{--color-brand-primary:#616161;--color-brand-secondary:#424242;--color-ui-primary:#00adee;--color-ui-es-orange:#f6911e;--color-theme-default:#616161;--color-theme-white:#ffffff;--color-theme-offwhite:#fafafa;--color-theme-gray:#9e9e9e;--color-theme-gray-lighter:#bdbdbd;--color-theme-gray-lightest:#d0d0d0;--color-theme-charcoal:#232323;--color-theme-black:#000000;--color-theme-mute:#e0e0e0;--color-theme-green:#63a83c;--color-theme-red:#dd1a22;--color-theme-purple:#7e4ceb;--color-theme-orange:#f6911e;--section-container-background-color:var(--color-theme-offwhite)}.svelte-1c4kgvu{box-sizing:border-box}:host{font-family:var(--text-font-family);font-size:var(--text-font-size-base)}.container.svelte-1c4kgvu{--day-width:calc(var(--size-base) * 1.75);--month-width:calc(var(--day-width) * 7);font-family:var(--text-font-family);color:var(--color-theme-charcoal);box-sizing:border-box;flex-direction:column}.full-width.svelte-1c4kgvu{width:var(--month-width);display:flex}.month-row.svelte-1c4kgvu{justify-content:space-between;align-items:center;padding-bottom:var(--size-quarter)}.weekday-names.svelte-1c4kgvu{font-size:var(--size-half);text-align:center;padding:var(--size-quarter) 0;color:var(--color-theme-default)}.weekday-name.svelte-1c4kgvu{flex-grow:1}.weeks.svelte-1c4kgvu{display:flex;flex-direction:column;align-items:stretch}.week.svelte-1c4kgvu{display:flex;text-align:center;font-size:calc(var(--size-base) * .75)}.day.svelte-1c4kgvu{width:var(--day-width);height:var(--day-width);display:flex;justify-content:center;align-items:center}button.svelte-1c4kgvu{width:var(--day-width);height:var(--day-width);border-radius:50%;padding:0;border:0;background-color:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center}button[data-selected=true].svelte-1c4kgvu{background-color:var(--color-ui-primary);color:var(--color-theme-offwhite)}button.svelte-1c4kgvu:focus{box-shadow:0 0 0 calc(var(--size-base) / 8 ) var(--color-theme-gray-lightest);outline:none}button.svelte-1c4kgvu::-moz-focus-inner{border:0}.day-color.svelte-1c4kgvu{width:100%;height:calc(var(--day-width) * .85);display:flex;align-items:center;justify-content:center}[data-range-right=true].svelte-1c4kgvu{background:linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0) 50%, rgba(0,173,238,0.2) 50%, rgba(0,173,238,0.2) 100%)}[data-range-left=true].svelte-1c4kgvu{background:linear-gradient(90deg, rgba(0,173,238,0.2) 0%, rgba(0,173,238,0.2) 50%, rgba(255,255,255,0) 50%, rgba(255,255,255,0) 100%)}[data-range-right=true][data-range-left=true].svelte-1c4kgvu{background:rgba(0,173,238,0.2)}.make-the-background-square-on-safari.svelte-1c4kgvu{position:relative}");
}

function get_each_context(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[18] = list[i];
	return child_ctx;
}

function get_each_context_1(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[21] = list[i];
	return child_ctx;
}

function get_each_context_2(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[24] = list[i];
	return child_ctx;
}

// (96:2) {#each daysOfTheWeek as dayOfTheWeek}
function create_each_block_2(ctx) {
	let span;
	let t0_value = /*dayOfTheWeek*/ ctx[24] + "";
	let t0;
	let t1;

	return {
		c() {
			span = element("span");
			t0 = text(t0_value);
			t1 = space();
			attr(span, "class", "weekday-name svelte-1c4kgvu");
		},
		m(target, anchor) {
			insert(target, span, anchor);
			append(span, t0);
			append(span, t1);
		},
		p: noop,
		d(detaching) {
			if (detaching) detach(span);
		}
	};
}

// (110:5) {:else}
function create_else_block(ctx) {
	let span1;
	let button;
	let span0;
	let t_value = /*visibleDate*/ ctx[21].day + "";
	let t;
	let span0_data_range_left_value;
	let span0_data_range_right_value;
	let button_data_selected_value;
	let mounted;
	let dispose;

	function click_handler_2() {
		return /*click_handler_2*/ ctx[12](/*visibleDate*/ ctx[21]);
	}

	function mouseover_handler() {
		return /*mouseover_handler*/ ctx[13](/*visibleDate*/ ctx[21]);
	}

	function mousedown_handler() {
		return /*mousedown_handler*/ ctx[14](/*visibleDate*/ ctx[21]);
	}

	function mouseup_handler() {
		return /*mouseup_handler*/ ctx[15](/*visibleDate*/ ctx[21]);
	}

	return {
		c() {
			span1 = element("span");
			button = element("button");
			span0 = element("span");
			t = text(t_value);
			attr(span0, "class", "day-color make-the-background-square-on-safari svelte-1c4kgvu");
			attr(span0, "data-range-left", span0_data_range_left_value = dateLte(/*visibleDate*/ ctx[21], /*end*/ ctx[2]) && dateGt(/*visibleDate*/ ctx[21], /*start*/ ctx[1]));
			attr(span0, "data-range-right", span0_data_range_right_value = dateGte(/*visibleDate*/ ctx[21], /*start*/ ctx[1]) && dateLt(/*visibleDate*/ ctx[21], /*end*/ ctx[2]));
			attr(button, "type", "button");
			attr(button, "draggable", "false");
			attr(button, "data-selected", button_data_selected_value = /*dateIsVisiblySelected*/ ctx[3](/*visibleDate*/ ctx[21]));
			attr(button, "class", "svelte-1c4kgvu");
			attr(span1, "class", "day svelte-1c4kgvu");
		},
		m(target, anchor) {
			insert(target, span1, anchor);
			append(span1, button);
			append(button, span0);
			append(span0, t);

			if (!mounted) {
				dispose = [
					listen(button, "click", function () {
						if (is_function(/*ifMouseEventShouldBeReactedTo*/ ctx[9](/*stopPropagationAndThen*/ ctx[8](click_handler_2)))) /*ifMouseEventShouldBeReactedTo*/ ctx[9](/*stopPropagationAndThen*/ ctx[8](click_handler_2)).apply(this, arguments);
					}),
					listen(button, "mouseover", function () {
						if (is_function(/*ifMouseEventShouldBeReactedTo*/ ctx[9](mouseover_handler))) /*ifMouseEventShouldBeReactedTo*/ ctx[9](mouseover_handler).apply(this, arguments);
					}),
					listen(button, "mousedown", function () {
						if (is_function(/*ifMouseEventShouldBeReactedTo*/ ctx[9](mousedown_handler))) /*ifMouseEventShouldBeReactedTo*/ ctx[9](mousedown_handler).apply(this, arguments);
					}),
					listen(button, "mouseup", mouseup_handler)
				];

				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			if (dirty & /*visibleWeeks*/ 16 && t_value !== (t_value = /*visibleDate*/ ctx[21].day + "")) set_data(t, t_value);

			if (dirty & /*visibleWeeks, end, start*/ 22 && span0_data_range_left_value !== (span0_data_range_left_value = dateLte(/*visibleDate*/ ctx[21], /*end*/ ctx[2]) && dateGt(/*visibleDate*/ ctx[21], /*start*/ ctx[1]))) {
				attr(span0, "data-range-left", span0_data_range_left_value);
			}

			if (dirty & /*visibleWeeks, start, end*/ 22 && span0_data_range_right_value !== (span0_data_range_right_value = dateGte(/*visibleDate*/ ctx[21], /*start*/ ctx[1]) && dateLt(/*visibleDate*/ ctx[21], /*end*/ ctx[2]))) {
				attr(span0, "data-range-right", span0_data_range_right_value);
			}

			if (dirty & /*dateIsVisiblySelected, visibleWeeks*/ 24 && button_data_selected_value !== (button_data_selected_value = /*dateIsVisiblySelected*/ ctx[3](/*visibleDate*/ ctx[21]))) {
				attr(button, "data-selected", button_data_selected_value);
			}
		},
		d(detaching) {
			if (detaching) detach(span1);
			mounted = false;
			run_all(dispose);
		}
	};
}

// (106:5) {#if visibleDate === null}
function create_if_block(ctx) {
	let span;

	return {
		c() {
			span = element("span");
			attr(span, "class", "day svelte-1c4kgvu");
		},
		m(target, anchor) {
			insert(target, span, anchor);
		},
		p: noop,
		d(detaching) {
			if (detaching) detach(span);
		}
	};
}

// (105:4) {#each week as visibleDate}
function create_each_block_1(ctx) {
	let if_block_anchor;

	function select_block_type(ctx, dirty) {
		if (/*visibleDate*/ ctx[21] === null) return create_if_block;
		return create_else_block;
	}

	let current_block_type = select_block_type(ctx);
	let if_block = current_block_type(ctx);

	return {
		c() {
			if_block.c();
			if_block_anchor = empty();
		},
		m(target, anchor) {
			if_block.m(target, anchor);
			insert(target, if_block_anchor, anchor);
		},
		p(ctx, dirty) {
			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
				if_block.p(ctx, dirty);
			} else {
				if_block.d(1);
				if_block = current_block_type(ctx);

				if (if_block) {
					if_block.c();
					if_block.m(if_block_anchor.parentNode, if_block_anchor);
				}
			}
		},
		d(detaching) {
			if_block.d(detaching);
			if (detaching) detach(if_block_anchor);
		}
	};
}

// (103:2) {#each visibleWeeks as week}
function create_each_block(ctx) {
	let div;
	let t;
	let each_value_1 = /*week*/ ctx[18];
	let each_blocks = [];

	for (let i = 0; i < each_value_1.length; i += 1) {
		each_blocks[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
	}

	return {
		c() {
			div = element("div");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t = space();
			attr(div, "class", "week svelte-1c4kgvu");
		},
		m(target, anchor) {
			insert(target, div, anchor);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].m(div, null);
			}

			append(div, t);
		},
		p(ctx, dirty) {
			if (dirty & /*visibleWeeks, dateIsVisiblySelected, ifMouseEventShouldBeReactedTo, stopPropagationAndThen, dispatchEvent, dateLte, end, dateGt, start, dateGte, dateLt*/ 830) {
				each_value_1 = /*week*/ ctx[18];
				let i;

				for (i = 0; i < each_value_1.length; i += 1) {
					const child_ctx = get_each_context_1(ctx, each_value_1, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
					} else {
						each_blocks[i] = create_each_block_1(child_ctx);
						each_blocks[i].c();
						each_blocks[i].m(div, t);
					}
				}

				for (; i < each_blocks.length; i += 1) {
					each_blocks[i].d(1);
				}

				each_blocks.length = each_value_1.length;
			}
		},
		d(detaching) {
			if (detaching) detach(div);
			destroy_each(each_blocks, detaching);
		}
	};
}

function create_fragment(ctx) {
	let div3;
	let div0;
	let span0;
	let t0_value = getMonthName(/*visibleMonth*/ ctx[0].month) + "";
	let t0;
	let t1;
	let t2_value = /*visibleMonth*/ ctx[0].year + "";
	let t2;
	let t3;
	let span1;
	let button0;
	let t5;
	let button1;
	let t7;
	let div1;
	let t8;
	let div2;
	let mounted;
	let dispose;
	let each_value_2 = /*daysOfTheWeek*/ ctx[6];
	let each_blocks_1 = [];

	for (let i = 0; i < each_value_2.length; i += 1) {
		each_blocks_1[i] = create_each_block_2(get_each_context_2(ctx, each_value_2, i));
	}

	let each_value = /*visibleWeeks*/ ctx[4];
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
	}

	return {
		c() {
			div3 = element("div");
			div0 = element("div");
			span0 = element("span");
			t0 = text(t0_value);
			t1 = space();
			t2 = text(t2_value);
			t3 = space();
			span1 = element("span");
			button0 = element("button");
			button0.textContent = "❮";
			t5 = space();
			button1 = element("button");
			button1.textContent = "❯";
			t7 = space();
			div1 = element("div");

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				each_blocks_1[i].c();
			}

			t8 = space();
			div2 = element("div");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			attr(span0, "class", "svelte-1c4kgvu");
			attr(button0, "type", "button");
			attr(button0, "class", "svelte-1c4kgvu");
			attr(button1, "type", "button");
			attr(button1, "class", "svelte-1c4kgvu");
			set_style(span1, "display", "flex");
			attr(span1, "class", "svelte-1c4kgvu");
			attr(div0, "class", "full-width month-row svelte-1c4kgvu");
			attr(div1, "class", "full-width weekday-names svelte-1c4kgvu");
			attr(div2, "class", "full-width weeks svelte-1c4kgvu");
			attr(div3, "class", "container full-width svelte-1c4kgvu");
		},
		m(target, anchor) {
			insert(target, div3, anchor);
			append(div3, div0);
			append(div0, span0);
			append(span0, t0);
			append(span0, t1);
			append(span0, t2);
			append(div0, t3);
			append(div0, span1);
			append(span1, button0);
			append(span1, t5);
			append(span1, button1);
			append(div3, t7);
			append(div3, div1);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				each_blocks_1[i].m(div1, null);
			}

			append(div3, t8);
			append(div3, div2);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].m(div2, null);
			}

			if (!mounted) {
				dispose = [
					listen(button0, "click", /*stopPropagationAndThen*/ ctx[8](/*click_handler*/ ctx[10])),
					listen(button1, "click", /*stopPropagationAndThen*/ ctx[8](/*click_handler_1*/ ctx[11]))
				];

				mounted = true;
			}
		},
		p(ctx, [dirty]) {
			if (dirty & /*visibleMonth*/ 1 && t0_value !== (t0_value = getMonthName(/*visibleMonth*/ ctx[0].month) + "")) set_data(t0, t0_value);
			if (dirty & /*visibleMonth*/ 1 && t2_value !== (t2_value = /*visibleMonth*/ ctx[0].year + "")) set_data(t2, t2_value);

			if (dirty & /*daysOfTheWeek*/ 64) {
				each_value_2 = /*daysOfTheWeek*/ ctx[6];
				let i;

				for (i = 0; i < each_value_2.length; i += 1) {
					const child_ctx = get_each_context_2(ctx, each_value_2, i);

					if (each_blocks_1[i]) {
						each_blocks_1[i].p(child_ctx, dirty);
					} else {
						each_blocks_1[i] = create_each_block_2(child_ctx);
						each_blocks_1[i].c();
						each_blocks_1[i].m(div1, null);
					}
				}

				for (; i < each_blocks_1.length; i += 1) {
					each_blocks_1[i].d(1);
				}

				each_blocks_1.length = each_value_2.length;
			}

			if (dirty & /*visibleWeeks, dateIsVisiblySelected, ifMouseEventShouldBeReactedTo, stopPropagationAndThen, dispatchEvent, dateLte, end, dateGt, start, dateGte, dateLt*/ 830) {
				each_value = /*visibleWeeks*/ ctx[4];
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
					} else {
						each_blocks[i] = create_each_block(child_ctx);
						each_blocks[i].c();
						each_blocks[i].m(div2, null);
					}
				}

				for (; i < each_blocks.length; i += 1) {
					each_blocks[i].d(1);
				}

				each_blocks.length = each_value.length;
			}
		},
		i: noop,
		o: noop,
		d(detaching) {
			if (detaching) detach(div3);
			destroy_each(each_blocks_1, detaching);
			destroy_each(each_blocks, detaching);
			mounted = false;
			run_all(dispose);
		}
	};
}

function instance($$self, $$props, $$invalidate) {
	let visibleWeeks;
	let dateIsVisiblySelected;
	const dispatchEvent = createEventDispatcher();
	let { start = { year: 2020, month: 1, day: 15 } } = $$props;
	let { end = { year: 2020, month: 2, day: 15 } } = $$props;
	let { visibleMonth = { year: 2020, month: 1 } } = $$props;
	const getMonthDaysArrays = (year, month) => calendarize(new Date(year, month - 1));
	const daysOfTheWeek = getDaysOfTheWeek();

	const switchMonth = increment => {
		let year = visibleMonth.year;
		let month = visibleMonth.month + increment;

		if (month < 1) {
			month += 12;
			year -= 1;
		} else if (month > 12) {
			month -= 12;
			year += 1;
		}

		$$invalidate(0, visibleMonth = { year, month });
	};

	const dayAsVisibleDate = day => ({
		year: visibleMonth.year,
		month: visibleMonth.month,
		day
	});

	const stopPropagationAndThen = fn => event => {
		event.stopPropagation();
		return fn(event);
	};

	const ifMouseEventShouldBeReactedTo = thenDo => event => {
		if (clickShouldBeInterceptedForNavigation(event)) {
			thenDo(event);
		}
	};

	const click_handler = () => switchMonth(-1);
	const click_handler_1 = () => switchMonth(1);
	const click_handler_2 = visibleDate => dispatchEvent('daySelected', visibleDate);
	const mouseover_handler = visibleDate => dispatchEvent('mouseoverDate', visibleDate);
	const mousedown_handler = visibleDate => dispatchEvent('mousedownDate', visibleDate);
	const mouseup_handler = visibleDate => dispatchEvent('mouseupDate', visibleDate);

	$$self.$$set = $$props => {
		if ('start' in $$props) $$invalidate(1, start = $$props.start);
		if ('end' in $$props) $$invalidate(2, end = $$props.end);
		if ('visibleMonth' in $$props) $$invalidate(0, visibleMonth = $$props.visibleMonth);
	};

	$$self.$$.update = () => {
		if ($$self.$$.dirty & /*visibleMonth*/ 1) {
			 $$invalidate(4, visibleWeeks = getMonthDaysArrays(visibleMonth.year, visibleMonth.month).map(weeks => weeks.map(dayNumber => dayNumber ? dayAsVisibleDate(dayNumber) : null)));
		}

		if ($$self.$$.dirty & /*start, end*/ 6) {
			 $$invalidate(3, dateIsVisiblySelected = date => {
				return datesMatch(date, start) || datesMatch(date, end);
			});
		}
	};

	return [
		visibleMonth,
		start,
		end,
		dateIsVisiblySelected,
		visibleWeeks,
		dispatchEvent,
		daysOfTheWeek,
		switchMonth,
		stopPropagationAndThen,
		ifMouseEventShouldBeReactedTo,
		click_handler,
		click_handler_1,
		click_handler_2,
		mouseover_handler,
		mousedown_handler,
		mouseup_handler
	];
}

class Month extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance, create_fragment, safe_not_equal, { start: 1, end: 2, visibleMonth: 0 }, add_css);
	}
}

/* src\DateRangeInput.svelte generated by Svelte v3.51.0 */

function add_css$1(target) {
	append_styles(target, "svelte-1cy62az", ":root,:host{--size-unit:4px;--size-quarter:var(--size-unit);--size-half:calc(var(--size-unit) * 2);--size-base:calc(var(--size-unit) * 4);--size-double:calc(var(--size-unit) * 8);--border-width:1px;--border-radius:var(--size-quarter);--size-default-spacing:var(--size-half);--control-height:calc(var(--size-unit) * 9)}:root,:host{--text-font-size-small:calc(var(--size-base) * .75);--text-font-size-base:var(--size-base);--text-font-family:Roboto, sans-serif;--text-font-weight-base:400;--text-font-weight-bold:700}.svelte-1cy62az{box-sizing:border-box}:host{font-family:var(--text-font-family);font-size:var(--text-font-size-base)}.container.svelte-1cy62az{display:flex}.hspace.svelte-1cy62az{width:var(--size-base)}");
}

function create_fragment$1(ctx) {
	let div;
	let month0;
	let updating_visibleMonth;
	let t0;
	let span;
	let t1;
	let month1;
	let updating_visibleMonth_1;
	let current;
	let mounted;
	let dispose;

	function month0_visibleMonth_binding(value) {
		/*month0_visibleMonth_binding*/ ctx[15](value);
	}

	let month0_props = {
		start: /*displayRange*/ ctx[5].start,
		end: /*displayRange*/ ctx[5].end
	};

	if (/*visibleStartMonth*/ ctx[0] !== void 0) {
		month0_props.visibleMonth = /*visibleStartMonth*/ ctx[0];
	}

	month0 = new Month({ props: month0_props });
	binding_callbacks.push(() => bind(month0, 'visibleMonth', month0_visibleMonth_binding));
	month0.$on("mousedownDate", /*mousedownDate_handler*/ ctx[16]);
	month0.$on("mouseoverDate", /*onMouseoverDate*/ ctx[7]);
	month0.$on("mouseupDate", /*onMouseupDate*/ ctx[8]);
	month0.$on("daySelected", /*onStartDaySelected*/ ctx[9]);

	function month1_visibleMonth_binding(value) {
		/*month1_visibleMonth_binding*/ ctx[17](value);
	}

	let month1_props = {
		start: /*displayRange*/ ctx[5].start,
		end: /*displayRange*/ ctx[5].end
	};

	if (/*visibleEndMonth*/ ctx[1] !== void 0) {
		month1_props.visibleMonth = /*visibleEndMonth*/ ctx[1];
	}

	month1 = new Month({ props: month1_props });
	binding_callbacks.push(() => bind(month1, 'visibleMonth', month1_visibleMonth_binding));
	month1.$on("mousedownDate", /*mousedownDate_handler_1*/ ctx[18]);
	month1.$on("mouseoverDate", /*onMouseoverDate*/ ctx[7]);
	month1.$on("mouseupDate", /*onMouseupDate*/ ctx[8]);
	month1.$on("daySelected", /*onEndDaySelected*/ ctx[10]);

	return {
		c() {
			div = element("div");
			create_component(month0.$$.fragment);
			t0 = space();
			span = element("span");
			t1 = space();
			create_component(month1.$$.fragment);
			attr(span, "class", "hspace svelte-1cy62az");
			attr(div, "class", "container svelte-1cy62az");
		},
		m(target, anchor) {
			insert(target, div, anchor);
			mount_component(month0, div, null);
			append(div, t0);
			append(div, span);
			append(div, t1);
			mount_component(month1, div, null);
			current = true;

			if (!mounted) {
				dispose = listen(window, "mouseup", /*clearAnyMouseDown*/ ctx[6]);
				mounted = true;
			}
		},
		p(ctx, [dirty]) {
			const month0_changes = {};
			if (dirty & /*displayRange*/ 32) month0_changes.start = /*displayRange*/ ctx[5].start;
			if (dirty & /*displayRange*/ 32) month0_changes.end = /*displayRange*/ ctx[5].end;

			if (!updating_visibleMonth && dirty & /*visibleStartMonth*/ 1) {
				updating_visibleMonth = true;
				month0_changes.visibleMonth = /*visibleStartMonth*/ ctx[0];
				add_flush_callback(() => updating_visibleMonth = false);
			}

			month0.$set(month0_changes);
			const month1_changes = {};
			if (dirty & /*displayRange*/ 32) month1_changes.start = /*displayRange*/ ctx[5].start;
			if (dirty & /*displayRange*/ 32) month1_changes.end = /*displayRange*/ ctx[5].end;

			if (!updating_visibleMonth_1 && dirty & /*visibleEndMonth*/ 2) {
				updating_visibleMonth_1 = true;
				month1_changes.visibleMonth = /*visibleEndMonth*/ ctx[1];
				add_flush_callback(() => updating_visibleMonth_1 = false);
			}

			month1.$set(month1_changes);
		},
		i(local) {
			if (current) return;
			transition_in(month0.$$.fragment, local);
			transition_in(month1.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(month0.$$.fragment, local);
			transition_out(month1.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(div);
			destroy_component(month0);
			destroy_component(month1);
			mounted = false;
			dispose();
		}
	};
}

function instance$1($$self, $$props, $$invalidate) {
	let displayRange;
	const dispatch = createEventDispatcher();
	let { start = { year: 2020, month: 1, day: 15 } } = $$props;
	let { end = { year: 2020, month: 2, day: 15 } } = $$props;
	let userSelectedStart = null;
	let userSelectedEnd = null;
	let startMouseDown = null;
	let endMouseDown = null;
	let mouseoverDate = null;
	let { visibleStartMonth = { year: start.year, month: start.month } } = $$props;
	let { visibleEndMonth = { year: end.year, month: end.month } } = $$props;

	const datesAsRange = (dateA, dateB) => {
		if (dateLte(dateA, dateB)) {
			return { start: dateA, end: dateB };
		} else {
			return { start: dateB, end: dateA };
		}
	};

	const getDisplayRange = ({ start, end, startMouseDown, endMouseDown, mouseoverDate }) => {
		if (startMouseDown) {
			start = startMouseDown;

			if (mouseoverDate && !datesMatch(mouseoverDate, start)) {
				end = mouseoverDate;
			}
		} else if (endMouseDown) {
			end = endMouseDown;

			if (mouseoverDate && !datesMatch(mouseoverDate, end)) {
				start = mouseoverDate;
			}
		}

		return datesAsRange(start, end);
	};

	const clearAnyMouseDown = () => {
		$$invalidate(2, startMouseDown = $$invalidate(3, endMouseDown = null));
	};

	const onMouseoverDate = ({ detail: date }) => {
		if (startMouseDown || endMouseDown) {
			$$invalidate(4, mouseoverDate = date);
		}
	};

	const onMouseupDate = ({ detail: date }) => {
		const mouseWasDown = startMouseDown || endMouseDown;
		const wasAClickOnStart = startMouseDown && datesMatch(date, startMouseDown);
		const wasAClickOnEnd = endMouseDown && datesMatch(date, endMouseDown);

		if (mouseWasDown && !wasAClickOnStart && !wasAClickOnEnd) {
			$$invalidate(13, userSelectedStart = displayRange.start);
			$$invalidate(14, userSelectedEnd = displayRange.end);
		}
	};

	const onStartDaySelected = ({ detail: date }) => {
		clearAnyMouseDown();

		if (dateGt(date, end)) {
			$$invalidate(13, userSelectedStart = end);
			$$invalidate(14, userSelectedEnd = date);
		} else if (!datesMatch(date, start)) {
			$$invalidate(13, userSelectedStart = date);
		}
	};

	const onEndDaySelected = ({ detail: date }) => {
		clearAnyMouseDown();

		if (dateLt(date, start)) {
			$$invalidate(14, userSelectedEnd = start);
			$$invalidate(13, userSelectedStart = date);
		} else if (!datesMatch(date, end)) {
			$$invalidate(14, userSelectedEnd = date);
		}
	};

	function month0_visibleMonth_binding(value) {
		visibleStartMonth = value;
		$$invalidate(0, visibleStartMonth);
	}

	const mousedownDate_handler = ({ detail: date }) => $$invalidate(4, mouseoverDate = $$invalidate(2, startMouseDown = date));

	function month1_visibleMonth_binding(value) {
		visibleEndMonth = value;
		$$invalidate(1, visibleEndMonth);
	}

	const mousedownDate_handler_1 = ({ detail: date }) => $$invalidate(4, mouseoverDate = $$invalidate(3, endMouseDown = date));

	$$self.$$set = $$props => {
		if ('start' in $$props) $$invalidate(11, start = $$props.start);
		if ('end' in $$props) $$invalidate(12, end = $$props.end);
		if ('visibleStartMonth' in $$props) $$invalidate(0, visibleStartMonth = $$props.visibleStartMonth);
		if ('visibleEndMonth' in $$props) $$invalidate(1, visibleEndMonth = $$props.visibleEndMonth);
	};

	$$self.$$.update = () => {
		if ($$self.$$.dirty & /*userSelectedStart, userSelectedEnd, start, end*/ 30720) {
			 {
				if (userSelectedStart || userSelectedEnd) {
					if (userSelectedStart) {
						$$invalidate(11, start = userSelectedStart);
						$$invalidate(13, userSelectedStart = null);
					}

					if (userSelectedEnd) {
						$$invalidate(12, end = userSelectedEnd);
						$$invalidate(14, userSelectedEnd = null);
					}

					dispatch('change', { start, end });
				}
			}
		}

		if ($$self.$$.dirty & /*start, end, startMouseDown, endMouseDown, mouseoverDate*/ 6172) {
			 $$invalidate(5, displayRange = getDisplayRange({
				start,
				end,
				startMouseDown,
				endMouseDown,
				mouseoverDate
			}));
		}
	};

	return [
		visibleStartMonth,
		visibleEndMonth,
		startMouseDown,
		endMouseDown,
		mouseoverDate,
		displayRange,
		clearAnyMouseDown,
		onMouseoverDate,
		onMouseupDate,
		onStartDaySelected,
		onEndDaySelected,
		start,
		end,
		userSelectedStart,
		userSelectedEnd,
		month0_visibleMonth_binding,
		mousedownDate_handler,
		month1_visibleMonth_binding,
		mousedownDate_handler_1
	];
}

class DateRangeInput extends SvelteComponent {
	constructor(options) {
		super();

		init(
			this,
			options,
			instance$1,
			create_fragment$1,
			safe_not_equal,
			{
				start: 11,
				end: 12,
				visibleStartMonth: 0,
				visibleEndMonth: 1
			},
			add_css$1
		);
	}
}

module.exports = DateRangeInput;
//# sourceMappingURL=bundle.js.map
