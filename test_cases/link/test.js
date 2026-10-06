/**
 * Link accessibility test assertions.
 * Supports native links and custom ARIA links.
 */

const getName = require('../../node_runner/helpers/get-name');
const { getVisualLabel } = require('../../node_runner/helpers/get-visual-label');
const { getHelperText } = require('../../node_runner/helpers/get-helper-text');
const detailedResults = require('../../node_runner/helpers/detailed-results');

// normalizeText - returns a string with whitespace collapsed and trimmed, or an empty string if there is no value
const normalizeText = (value) => (value || '').toString().replace(/[\s\u00A0]+/g, ' ').trim();

// summariseList - returns a string summarising the items in an array, up to maxItems
const summarizeList = (items, maxItems = 8) => {
    // Ensure we've removed any null/undefined values
    const filtered = items.filter(Boolean);
    // If there are no items, return an empty string
    if (filtered.length === 0) return '';
    // If the number of items is less than or equal to maxItems, return them joined by commas
    if (filtered.length <= maxItems) return filtered.join(', ');
    // Otherwise, return the first maxItems items followed by a count of the remaining items
    return `${filtered.slice(0, maxItems).join(', ')}, and ${filtered.length - maxItems} more`;
};

// quoteText - returns a string with the value wrapped in double quotes, or an empty string if there is no value
const quoteText = (value) => {
    const t = normalizeText(value);
    return t ? `"${t}"` : '';
};

// describeControl - returns a string describing a control, using its name or text if available, or its index if not
const describeControl = (item, controlType, index = null) => {
    // Normalise the name or text content of the control, or use an empty string if neither is available
    const chosenLabel = normalizeText(item.name || item.textContent || '');
    // Determine the ordinal position of the control if an index is provided
    const ordinal = Number.isInteger(index) ? index + 1 : null;
    // If there is a text label, return this
    if (chosenLabel) return `${controlType} ${quoteText(chosenLabel)}`;
    // If there's no text label, return the position of the element
    if (ordinal) return `${controlType} ${ordinal}`;
    // Otherwise, return just the control type
    return controlType;
};

// describeLink - returns a string describing a link, using its text or name if available, or its index if not
const describeLink = (link, index) => {
    const label = normalizeText( link.name || link.textContent || '' );
    if (label) return `link "${label}"`;
    if (label.meta && label.meta && label.meta.domIndex !== undefined) {
        return `link ${index + 1} ${label.meta.domIndex}`;
    }
    return `link ${index + 1}`;
};

module.exports.run = async ({ page, assert, utils }) => {

    const isEitherImplicitOrExplicitLink = async (linkLocator) => {
      return await linkLocator.evaluate((el) => {
        const explicitRole = (el.getAttribute('role') || '').trim().toLowerCase();
        const isNativeLink = el.matches('a');
        // If it uses a native a element, check if it has a href attribute, which is required for it to have an implicit role of link
        if (isNativeLink) {
            const hrefValue = el.getAttribute('href');
            if (hrefValue === null) {
                return false;
            } else {
              return true;
            }
        }
        // If it uses a custom element with role="link", return that it has an explicit role of link
        if (explicitRole === 'link') {
            return true;
        }
      })
    };

    const filterInvalidRoles = async (links) => {
      let filteredLinks = [];

      for (const [index, link] of links.entries()) {
          const hasValidRole = await isEitherImplicitOrExplicitLink(link.locator);
          // If there is no valid role, add the link description to the invalidLinks array
          if (hasValidRole) {
              filteredLinks.push(link);
          }
      }

      return filteredLinks;
    }

    const discoverLinks = async (scope) => {
        // Playwright locator to find all a elements and elements with a role="link" attribute within the given scope
        const linkLocator = scope.locator('a, [role="link"]');
        const count = await linkLocator.count();
        const links = [];

        // Iterate through each link found and gather its properties
        for (let index = 0; index < count; index++) {
            // I'm not sure why we use nth() here instead of just using the index directly, but we're looping through each link
            const locator = linkLocator.nth(index);
            const [name, textContent, rawHelperText, visible, meta] = await Promise.all([
                getName(locator),
                locator.evaluate((el) => el.textContent.toString().trim()),
                getHelperText(locator),
                locator.isVisible(),
                locator.evaluate((el, args) => {
                    const { idx } = args;
                    const normalizeText = (value) => (value || '').toString().replace(/\s+/g, ' ').trim();
                    const parseAriaBoolean = (value) => {
                        if (value === 'true') {
                            return true;
                        }
                        if (value === 'false') {
                            return false;
                        }
                        return null;
                    };

                    const getNodePath = (element) => {
                        // If there is no element, return an empty string
                        if (!element) {
                            return '';
                        }
                        const segments = [];
                        let current = element;
                        // Traverse up the DOM tree, building a path of tag names and IDs until we reach the root
                        while (current && current.nodeType === Node.ELEMENT_NODE) {
                            let segment = current.tagName.toLowerCase();
                            // If the current element has an ID, use that as the segment and stop traversing
                            if (current.id) {
                                segment += `#${current.id}`;
                                segments.unshift(segment);
                                break;
                            }
                            // If the current element has no ID, we need to find its index among its siblings of the same tag name
                            let siblingIndex = 1;
                            let sibling = current;
                            while ((sibling = sibling.previousElementSibling) !== null) {
                                if (sibling.tagName === current.tagName) {
                                    siblingIndex += 1;
                                }
                            }
                            // Add the nth-of-type pseudo-class to the segment to indicate its position among siblings
                            segment += `:nth-of-type(${siblingIndex})`;
                            segments.unshift(segment);
                            current = current.parentElement;
                        }
                        // Return the segments joined by ' > ' to represent the full path from the root to the element
                        return segments.join(' > ');
                    };
                    const isNativeLink = el.matches && el.matches('a[href]');
                    const ariaDisabled = el.getAttribute && el.getAttribute('aria-disabled');
                    const nativeDisabled = isNativeLink ? !!el.hasAttribute('disabled') : el.hasAttribute('disabled');
                    const ariaDisabledState = parseAriaBoolean(ariaDisabled);
                    const disabled = isNativeLink ? nativeDisabled : (ariaDisabledState === true || nativeDisabled);
                    return {
                        domIndex: idx,
                        disabled,
                        tabIndex: el.tabIndex,
                        controlText: (el.innerText || el.textContent || '').toString().trim(),
                        nodePath: getNodePath(el),
                    };
                }, { idx: index })
            ]);
            // Normalize the helper text to always be an array, even if it's a single string or null
            const helperText = Array.isArray(rawHelperText) ? rawHelperText : (rawHelperText ? [rawHelperText] : []);
            // Create an object representing the link with its properties
            const item = {
                locator,
                domIndex: meta.domIndex !== undefined ? meta.domIndex : index,
                name,
                textContent,
                helperText,
                visible,
                disabled: !!meta.disabled,
                tabIndex: meta.tabIndex,
                href: meta.href || null,
            };
            // Add the link object to the links array
            links.push(item);
        }
        // Return an object containing the discovered links, an empty groups array, and the control type as 'link'
        return { links, groups: [], controlType: 'link' };
    };
    
    // Discover all links on the page
    const finalDiscovery = await discoverLinks(page);
    
    // Check that each link has a valid role (R - WCAG 4.1.2)
    await assert("Each link has a valid role", async () => {
        const links = finalDiscovery.links;
        // If there are no links found, return a failure message
        if (links.length === 0) {
            return { pass: false, message: 'No links found in scope' };
        }
        const invalidLinks = [];
        // Loop through each link and check if it has a valid role
        for (const [index, link] of links.entries()) {
            const hasValidRole = await isEitherImplicitOrExplicitLink(link.locator);
            // If there is no valid role, add the link description to the invalidLinks array
            if (!hasValidRole) {
                invalidLinks.push(describeLink(link, index));
            }
        }
        // If there are no invalid links, return a pass message
        if (invalidLinks.length === 0) {
            return { pass: true, message: 'All links expose valid link roles' };
        }
        // Otherwise, return a failure message with the list of invalid links
        return { pass: false, message: `Invalid link role on ${summarizeList(invalidLinks)}` };
    });

    // Check that each link has an accessible name (R - WCAG 4.1.2)
    await assert("Each link has an accessible name", async () => {
        const links = finalDiscovery.links;
        // If there are no links found, return a failure message
        if (links.length === 0) {
            return { pass: false, message: 'No links found in scope' };
        }

        let filteredLinks = await filterInvalidRoles(links);

        // Map through the links and create an array of descriptions for links that do not have an accessible name
        const unnamedLinks = filteredLinks
          .map((link, index) => {
            if (link.name && link.name.trim()) return null;
            return describeLink(link, index);
          })
          .filter(Boolean);
        
        // If there are no unnamed links, return a pass message
        if (unnamedLinks.length === 0) {
            return { pass: true, message: `All ${links.length} links have accessible names ${summarizeList(unnamedLinks)}` };
        }
        // Otherwise, return a failure message with the list of unnamed links
        return { pass: false, message: `Missing accessible names for ${summarizeList(unnamedLinks)}` };
    });

    // Check that visible label text is included in the accessible name (R - WCAG 2.5.3)
    await assert("Visible label is included in accessible name", async () => {
        const links = finalDiscovery.links;
        // If there are no links found, return a failure message
        if (links.length === 0) {
            return { pass: false, message: 'No links found in scope' };
        }

        let filteredLinks = await filterInvalidRoles(links);

        // Normalize for comparison:
        // - strip emoji pictographics (non-speakable for voice input)
        // - replace all Unicode punctuation with spaces
        // - collapse whitespace (including NBSP)
        // - trim + lowercase
        const normalizeForCompare = (s) => (s || '')
            .toString()
            .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, ' ')
            .replace(/\p{P}+/gu, ' ')
            .replace(/[\s\u00A0]+/g, ' ')
            .trim()
            .toLowerCase();

        // Remove common non-essential "required" indicators from visible labels only.
        const stripRequiredIndicators = (s) => (s || '')
            .toString()
            .replace(/\(\s*required\s*\)/gi, '')
            .replace(/\brequired\b/gi, '');

        // Only applies when there is a visible text label (not placeholder-only)
        let applicable = 0;
        const labelMismatchMessages = [];
        let results = new detailedResults();

        // Loop through each link and check if the visible label is included in the accessible name
        for (const [index, link] of filteredLinks.entries()) {
            const vl = link.textContent;
            if (!vl) {
              // no visible text label  
              continue;
            }
            applicable++;

            const labelNorm = normalizeForCompare(stripRequiredIndicators(vl));
            const nameNorm = normalizeForCompare(link.name || '');

            // Accessible name should contain the visible label text in the same order
            if (labelNorm && nameNorm.includes(labelNorm)) {
                results.addPass(link.locator);
            } else {
                results.addFail(link.locator);
                labelMismatchMessages.push(`${describeControl(link, 'link', index)} has visible label ${quoteText(vl)} but accessible name ${quoteText(link.name || 'missing')}`);
            }
        }

        // If there are any label mismatches, add a message to the results
        if (labelMismatchMessages.length > 0) {
            results.addMessage(`Visible label mismatch: ${summarizeList(labelMismatchMessages)}`);
        } else {
            results.addMessage('All visible labels are included in accessible names');
        }

        // If there are no applicable links, add a message to the results and force the test to be not applicable
        if (applicable === 0) {
            results.addMessage("No links with visible text labels applicable to 2.5.3");
            results.forceNotApplicable();
        }

        return { status: results.status(), message: results.getMessage() };
    });

    // Check that each link can be used with only a keyboard (R - WCAG 2.1.1)
    await assert("Each link is keyboard reachable", async () => {
        // Reload the page to ensure a fresh state for testing
        await utils.reload();
        
        // Use the previously discovered links if available, otherwise discover them again
        const currentDiscovery = finalDiscovery || await discoverLinks(page);

        // If there are no links found, return a failure message
        if (!currentDiscovery || currentDiscovery.links.length === 0) {
            return { pass: false, message: 'No links found in scope' };
        }

        // Collect the indexes of all links that are reachable via keyboard (tab key)
        const tabReachable = await utils.testFormControls.collectTabReachableIndexes(
            page, 'a, [role="link"]'
        );

        // Map through the links and create an array of descriptions for links that are not reachable via keyboard
        const unreachable = currentDiscovery.links
            .map((link, index) => {
                if (link.disabled) return null;
                return tabReachable.has(link.domIndex) ? null : describeLink(link, index);
            })
            .filter(Boolean);

        // If there are no unreachable links, return a pass message
        if (unreachable.length === 0) {
            return { pass: true, message: 'Each interactive link is keyboard reachable' };
        }

        // Otherwise, return a failure message with the list of unreachable links
        return { pass: false, message: `Not keyboard reachable: ${summarizeList(unreachable)}` };
    });

    // Check that the Enter key activates links (this is probably more best practice, as technically any key could be used, as long as it is described and people can identify this)
    await assert("Enter activates link", async () => {
        // Reload the page to ensure a fresh state for testing
        await utils.reload();
        
        // Use the previously discovered links if available, otherwise discover them again
        const currentDiscovery = finalDiscovery || await discoverLinks(page);

        // If there are no links found, return a failure message
        if (!currentDiscovery || currentDiscovery.links.length === 0) {
            return { pass: false, message: 'No links found in scope' };
        }

        // Collect the indexes of all links that are reachable via keyboard (tab key)
        const tabReachable = await utils.testFormControls.collectTabReachableIndexes(
            page, 'a, [role="link"]'
        );

        // Map through the links and create an array of descriptions for links that are not reachable via keyboard or are disabled
        const nonInteractiveLinks = currentDiscovery.links
            .map((link, index) => (!tabReachable.has(link.domIndex) || link.disabled) ? describeLink(link, index) : null)
            .filter(Boolean);

        let applicableLinks = 0;
        let passingLinks = 0;
        const failedLinks = [];

        // Loop through each link and attempt to activate it using the Enter key, checking if the link is reachable and not disabled
        for (let linkIndex = 0; linkIndex < currentDiscovery.links.length; linkIndex += 1) {
            await utils.reload();
            const current = finalDiscovery || await discoverLinks(page);
            const link = current.links[linkIndex];
            if (!link || !tabReachable.has(link.domIndex) || link.disabled) {
                continue;
            }

            applicableLinks += 1;

            // Use the stored locator for the link to try and focus it
            const locator = link.locator;
            await locator.focus();

            // Attempt activation via Enter and detect navigation by checking href change or focus change
            const beforeHref = await locator.evaluate((el) => el.href || null);
            await locator.press('Enter');
            await page.waitForTimeout(30);

            const afterHref = await page.evaluate((idx) => {
                const el = document.querySelectorAll('a[href], [role="link"]')[idx];
                return el ? (el.href || null) : null;
            }, link.domIndex);

            // If the href has changed, we consider the link activation successful
            if (beforeHref !== afterHref) {
                passingLinks += 1;
            } else {
                // Fallback: if element became blurred or document.location changed then we still consider it a pass
                const urlChanged = page.url && page.url() !== beforeHref;
                if (urlChanged) {
                    passingLinks += 1;
                } else {
                    // Otherwise, consider this a fail
                    failedLinks.push(describeLink(link, linkIndex));
                }
            }
        }

        // If there are no applicable links, return a failure message indicating that no interactive links were available for Enter key testing
        if (applicableLinks === 0) {
            const suffix = nonInteractiveLinks.length > 0
                ? `: ${summarizeList(nonInteractiveLinks)}`
                : '';
            return { pass: false, message: `No interactive links were available for Enter-key testing${suffix}` };
        }

        // If all of the links were activated on Enter, return a pass message
        if (passingLinks === applicableLinks) {
            return { pass: true, message: 'Enter activates each link' };
        }

        // Otherwise, return a fail message with the list of links that failed to activate on Enter
        return { pass: false, message: `Enter did not activate ${summarizeList(failedLinks)}` };
    });

    return {};
};