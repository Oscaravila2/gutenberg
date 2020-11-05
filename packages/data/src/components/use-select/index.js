/**
 * External dependencies
 */
import { useMemoOne } from 'use-memo-one';

/**
 * WordPress dependencies
 */
import { createQueue } from '@wordpress/priority-queue';
import {
	useLayoutEffect,
	useRef,
	useCallback,
	useEffect,
	useReducer,
} from '@wordpress/element';
import isShallowEqual from '@wordpress/is-shallow-equal';

/**
 * Internal dependencies
 */
import useRegistry from '../registry-provider/use-registry';
import useAsyncMode from '../async-mode-provider/use-async-mode';

/**
 * Favor useLayoutEffect to ensure the store subscription callback always has
 * the selector from the latest render. If a store update happens between render
 * and the effect, this could cause missed/stale updates or inconsistent state.
 *
 * Fallback to useEffect for server rendered components because currently React
 * throws a warning when using useLayoutEffect in that environment.
 */
const useIsomorphicLayoutEffect =
	typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const renderQueue = createQueue();

/**
 * Custom react hook for retrieving props from registered selectors.
 *
 * In general, this custom React hook follows the
 * [rules of hooks](https://reactjs.org/docs/hooks-rules.html).
 *
 * @param {Array}    storeKey    If provided, this invokes mapSelect only when
 *                               specific stores change, not the entire registry.
 * @param {Function} _mapSelect  Function called on every state change. The
 *                               returned value is exposed to the component
 *                               implementing this hook. If `storeKey` is provided,
 *                               The function receives the `registry.select( storeKey )`
 *                               object. Otherwise it receices the `registry.select` method
 *                               on the first argument and the `registry` on the second
 *                               argument.
 * @param {Array}    deps        If provided, this memoizes the mapSelect so the
 *                               same `mapSelect` is invoked on every state
 *                               change unless the dependencies change.
 * @example
 * ```js
 * const { useSelect } = wp.data;
 *
 * function HammerPriceDisplay( { currency } ) {
 *   const price = useSelect( ( select ) => {
 *     return select( 'my-shop' ).getPrice( 'hammer', currency )
 *   }, [ currency ] );
 *   return new Intl.NumberFormat( 'en-US', {
 *     style: 'currency',
 *     currency,
 *   } ).format( price );
 * }
 *
 * // Rendered in the application:
 * // <HammerPriceDisplay currency="USD" />
 * ```
 *
 * In the above example, when `HammerPriceDisplay` is rendered into an
 * application, the price will be retrieved from the store state using the
 * `mapSelect` callback on `useSelect`. If the currency prop changes then
 * any price in the state for that currency is retrieved. If the currency prop
 * doesn't change and other props are passed in that do change, the price will
 * not change because the dependency is just the currency.
 *
 * @return {Function}  A custom react hook.
 */
export default function useStoreSelect( _mapSelect, deps = [] ) {
	const dependentStores = useRef( {} );

	const registry = useRegistry();
	const onStoreChange = useCallback( () => {
		if ( isMountedAndNotUnsubscribing.current ) {
			try {
				const newMapOutput = latestMapSelect.current(
					registry.select( registry.select, registry )
				);
				if ( isShallowEqual( latestMapOutput.current, newMapOutput ) ) {
					return;
				}
				latestMapOutput.current = newMapOutput;
			} catch ( error ) {
				latestMapOutputError.current = error;
			}
			forceRender();
		}
	}, [ registry ] );

	// @TODO memoize
	const onChange = () => {
		if ( latestIsAsync.current ) {
			renderQueue.add( queueContext, onStoreChange );
		} else {
			onStoreChange();
		}
	};

	const updateSubscriptions = useCallback( ( next ) => {
		const current = [ ...Object.keys( dependentStores.current ) ];
		const nextSet = new Set( next );
		for ( const storeKey in dependentStores.current ) {
			if ( ! nextSet.has( storeKey ) ) {
				// Unsubscribe
				dependentStores.current[ storeKey ]();
				delete dependentStores.current[ storeKey ];
			}
		}
		for ( const storeKey of nextSet ) {
			if ( ! ( storeKey in dependentStores.current ) ) {
				// Subscribe
				dependentStores.current[ storeKey ] = registry.stores[
					storeKey
				].subscribe( onChange );
			}
		}
	}, [] );

	/**
	 * Call the original mapSelect with a Proxy object,
	 * each used selector will be
	 */
	const mapSelect = useCallback(
		( select, registry ) => {
			registry.__experimentalStartRecordingSelectStores();
			const retval = _mapSelect( select, registry );
			updateSubscriptions(
				registry.__experimentalStopRecordingSelectStores()
			);
			return retval;
		},
		deps // @TODO: account for a different _mapSelect ?
	);

	const isAsync = useAsyncMode();
	// React can sometimes clear the `useMemo` cache.
	// We use the cache-stable `useMemoOne` to avoid
	// losing queues.
	const queueContext = useMemoOne( () => ( { queue: true } ), [ registry ] );
	const [ , forceRender ] = useReducer( ( s ) => s + 1, 0 );

	const latestMapSelect = useRef();
	const latestIsAsync = useRef( isAsync );
	const latestMapOutput = useRef();
	const latestMapOutputError = useRef();
	const isMountedAndNotUnsubscribing = useRef();

	let mapOutput;

	try {
		if (
			latestMapSelect.current !== mapSelect ||
			latestMapOutputError.current
		) {
			mapOutput = mapSelect( registry.select, registry );
		} else {
			mapOutput = latestMapOutput.current;
		}
	} catch ( error ) {
		let errorMessage = `An error occurred while running 'mapSelect': ${ error.message }`;

		if ( latestMapOutputError.current ) {
			errorMessage += `\nThe error may be correlated with this previous error:\n`;
			errorMessage += `${ latestMapOutputError.current.stack }\n\n`;
			errorMessage += 'Original stack trace:';

			throw new Error( errorMessage );
		} else {
			// eslint-disable-next-line no-console
			console.error( errorMessage );
		}
	}

	useIsomorphicLayoutEffect( () => {
		latestMapSelect.current = mapSelect;
		latestMapOutput.current = mapOutput;
		latestMapOutputError.current = undefined;
		isMountedAndNotUnsubscribing.current = true;

		// This has to run after the other ref updates
		// to avoid using stale values in the flushed
		// callbacks or potentially overwriting a
		// changed `latestMapOutput.current`.
		if ( latestIsAsync.current !== isAsync ) {
			latestIsAsync.current = isAsync;
			renderQueue.flush( queueContext );
		}
	} );

	useIsomorphicLayoutEffect( () => {
		// catch any possible state changes during mount before the subscription
		// could be set.
		onChange();
		return () => {
			isMountedAndNotUnsubscribing.current = false;
			renderQueue.flush( queueContext );
			for ( const storeKey in dependentStores.current ) {
				dependentStores.current[ storeKey ]();
				delete dependentStores.current[ storeKey ];
			}
		};
	}, [ registry ] );

	return mapOutput;
}
