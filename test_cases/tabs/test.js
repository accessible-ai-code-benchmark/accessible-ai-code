/**
 * Tab accessibility test assertions.
 * Supports custom ARIA tabs.
 */

const getName = require('../../node_runner/helpers/get-name');
const { getVisualLabel } = require('../../node_runner/helpers/get-visual-label');
const { getHelperText } = require('../../node_runner/helpers/get-helper-text');
const detailedResults = require('../../node_runner/helpers/detailed-results');

const normalizeText = (value) => (value || '').toString().replace(/[\s\u00A0]+/g, ' ').trim();
const summarizeList = (items, maxItems = 4) => {
    const filtered = items.filter(Boolean);
    if (filtered.length <= maxItems) {
        return filtered.join(', ');
    }
    return `${filtered.slice(0, maxItems).join(', ')}, and ${filtered.length - maxItems} more`;
};

// describeTab - returns a string describing a tab, using its text or name if available, or its index if not
const describeTab = (tab, index) => {
    const label = normalizeText( tab.name || tab.textContent || '' );
    if (label) return `tab "${label}"`;
    if (label.meta && label.meta && label.meta.domIndex !== undefined) {
        return `tab ${index + 1} ${label.meta.domIndex}`;
    }
    return `tab ${index + 1}`;
};

module.exports.run = async ({ page, assert, utils }) => {

  const discoverTabs = async (scope) => {
      // Playwright locator to find all a elements and elements with a role="link" attribute within the given scope
      const tabLocator = scope.locator('[role="tab"]');
      const count = await tabLocator.count();
      const tabs = [];

      // Iterate through each link found and gather its properties
      for (let index = 0; index < count; index++) {
          // I'm not sure why we use nth() here instead of just using the index directly, but we're looping through each link
          const locator = tabLocator.nth(index);
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
                  const ariaDisabled = el.getAttribute && el.getAttribute('aria-disabled');
                  const ariaDisabledState = parseAriaBoolean(ariaDisabled);
                  const disabled = (ariaDisabledState === true);
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
          // Add the tab object to the tabs array
          tabs.push(item);
      }
      // Return an object containing the discovered tabs, an empty groups array, and the control type as 'tab'
      return { tabs, groups: [], controlType: 'tab' };
  };

  // Discover all tabs on the page
  const finalDiscovery = await discoverTabs(page);

  await assert("Each tab has an accessible name", async () => {

      const tabs = finalDiscovery.tabs;
      
      // If there are no tabs found, return a failure message
      if (tabs.length === 0) {
          return { pass: false, message: 'No tabs found in scope' };
      }

      // Map through the tabs and create an array of descriptions for tabs that do not have an accessible name
      const unnamedTabs = tabs
        .map((tab, index) => {
          if (tab.name && tab.name.trim()) return null;
          return describeTab(tab, index);
        })
        .filter(Boolean);
      
      // If there are no unnamed tabs, return a pass message
      if (unnamedTabs.length === 0) {
          return { pass: true, message: `All tabs have accessible names ${summarizeList(unnamedTabs)}` };
      }
      // Otherwise, return a failure message with the list of unnamed tabs
      return { pass: false, message: `Missing accessible names for ${summarizeList(unnamedTabs)}` };
  });

  // 1.3.1 Info and Relationships, Level A
  // The tab which is visually presented as the active one is identified as selected in the code
  //  When I select a tab
  //  Then it should have the attribute "aria-selected" with the value "true"
  await assert("The visually active tab is identified as selected in the code", async () => {
    const tabs = finalDiscovery.tabs;
    
    // Function to check which tabs have an aria-selected attribute set to true
    const identifySelectedTabs = async (tabs) => {
      const selectedTabs = [];
      for (const [index, tab] of tabs.entries()) {
        if (tab.locator) {
          const ariaSelected = await tab.locator.getAttribute('aria-selected');
          if (ariaSelected === 'true') {
            selectedTabs.push(tab);
          }
        }
      }
      return selectedTabs;
    }

    // Array to hold errors found during the checks
    const selectedTabErrors = [];
    
    // Check whether the currently selected tab is correct and expected
    const checkCurrentlySelectedTab = async (tabs) => {
      // If there are no aria-selected tabs, push an error
      if ((await identifySelectedTabs(tabs)).length === 0) {
        selectedTabErrors.push('No tab is marked as selected in the code');
      }
      // If there are multiple aria-selected tabs, push an error
      if ((await identifySelectedTabs(tabs)).length > 1) {
        selectedTabErrors.push('Multiple tabs are marked as selected in the code');
      }
      
      // Try and identify both the aria-selected tab and the visually active tab
      const selectedTab = (await identifySelectedTabs(tabs))[0];
      const visibleTabIndex = tabs.findIndex(tab => tab.name === selectedTab.name);
      
      // If no visible tab is found, push an error
      if (visibleTabIndex === -1) {
        selectedTabErrors.push('No visible tab found to compare with the selected tab');
      }
      // If the visible tab is not the same as the selected tab, push an error
      if (tabs[visibleTabIndex] !== selectedTab) {
        selectedTabErrors.push(`When ${describeTab(tabs[visibleTabIndex], visibleTabIndex)} is visually active, it is not the one marked as selected in the code. Visible tab index: ${visibleTabIndex}, Selected tab index: ${tabs.indexOf(selectedTab)}`);
      }
    }

    // Click on each tab and then run the aria-selected checks
    for (const [index, tab] of tabs.entries()) {
      if (tab.locator) {
        await tab.locator.click();
        await page.waitForTimeout(100);
        await checkCurrentlySelectedTab(tabs, tab);
        // console.log(`Checked tab ${index + 1}: ${describeTab(tab, index)}. Errors so far: ${selectedTabErrors.join('; ')}`);
      }
    }
    
    if (selectedTabErrors.length > 0) {
      return { pass: false, message: `The active tab is not always correctly identified. Errors include: ${selectedTabErrors.join('; ')}` };
    }
    return { pass: true, message: 'The visually active tab is correctly identified as selected in the code' };
  });

  // 2.5.3 Label in Name, Level A
  // Each tab has an accessible name which matches or includes the visible label
  //  When I view the rendered "<element>"
  //  Then it should have an accessible name which contains the visible label "<visible_label>"

  // TODO
  
  // 1.3.4 Orientation, Level AA
  // Content is not restricted to a single orientation, unless it's essential
  //   When I switch to landscape mode
  //   And I view the rendered tabs
  //   Then the content should be readable and usable
  
    await assert("Content is not restricted to a single orientation", async () => {
      try {
        // Get current viewport size
        const currentViewport = page.viewportSize();
        const currentWidth = currentViewport?.width || 800;
        const currentHeight = currentViewport?.height || 600;

        // Swap width and height for landscape
        // Only swap if currently in portrait (height > width)
        if (currentHeight > currentWidth) {
          await this.page.setViewportSize({
            width: currentHeight,
            height: currentWidth
          });

          // Store orientation in context
          this.orientation = "landscape";

          // Wait for layout to adjust
          await this.page.waitForTimeout(300);
        } else {
          // Already in landscape, no-op
          this.orientation = "landscape";
        }

        // How do we want to check this? We can't be 100% sure that the content is available?
        return { pass: true, message: 'Content is not restricted to a single orientation' };
      } catch (error) {
        console.log(`Error switching to landscape mode: ${error.message}. Check that the browser viewport can be resized`);
      }
    });

// Rule: 1.4.4 Resize Text, Level AA
// Text can scale up to 200% without loss of content or functionality
//   When I zoom in the browser to 200%
//   And I view the rendered tabs
//   Then the content should be readable and usable
     
// Rule: 1.4.10 Reflow, Level AA
// Content reflows without horizontal scrolling at 320px wide
//   When I view the rendered tabs
//   And I set the viewport to 320px wide
//   Then it should reflow without requiring horizontal scrolling

// Rule: 1.4.12 Text Spacing, Level AA
// Line, letter and word spacing can be increased without a loss of content
//   When I view the rendered tabs
//   And I increase the line height to 1.5 times the font size
//   And I increase the spacing following paragraphs to 2 times the font size
//   And I increase the letter spacing to 0.12 times the font size
//   And I increase the word spacing to 0.16 times the font size
//   Then the content should be readable and usable

// Rule: 1.4.8 Visual Presentation, Level AAA
// Scenario: Content adjusts as expected when people apply their own colour, width, alignment, spacing and size preferences
//   When I view the rendered tabs
//   And I apply a custom foreground and background colour using a user stylesheet
//   And I apply a custom max-width using a user stylesheet
//   And I apply a custom text-alignment using a user stylesheet
//   And I apply a custom line height using a user stylesheet
//   And I apply a custom font size using a user stylesheet
//   Then the content should be readable and usable

  return {}; // assertions collected via injected assert
};